/**
 * 资料识别的编排层：起任务、跑引擎、归一化落盘、取消、重试。
 *
 * 三条纪律：
 * 1. **路由立即返回**，识别在本机后台跑；关掉页面不取消任务（profile §7.4）。
 * 2. 引擎输出写到**系统临时目录**，不写工作区——学生用书的上游产物约 750 MB
 *    （其中 `_layout.pdf` + `_span.pdf` 就占 544 MB），只有归一化后的那几个文件进工作区。
 * 3. 后台任务**绝不吞异常**：失败一律落进任务记录（`failed` + 可读原因 + 日志尾部），
 *    否则界面只会看到一个永远转圈的"识别中"。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookType } from "../db/types.ts";
import { copyIntoWorkspace } from "../workspace/files.ts";
import { originalsDir } from "../workspace/paths.ts";
import { join as joinPath } from "node:path";
import {
  assertImportable,
  createJob,
  normalizeIntoWorkspace,
  patchJob,
  readJob,
  readManifest,
  storeOriginal,
} from "./jobs.ts";
import {
  DEFAULT_MINERU_OPTIONS,
  checkMineru,
  locateUpstream,
  mineruPython,
  spawnMineru,
  cancelProcessTree,
  type MineruHandle,
} from "./mineru.ts";
import { countPdfPages } from "./pages.ts";
import type { ContentListBlock } from "../knowledge/ocr-pages.ts";
import type { MiddleFile } from "./normalize.ts";
import { OcrError, type OcrJobRecord } from "./types.ts";
import { DEFAULT_PAGE_IMAGE } from "./pages.ts";

/** 正在跑的任务句柄（进程级）：用于取消。服务重启后靠 pid 判定，不依赖这张表。 */
const running = new Map<string, MineruHandle>();

/**
 * 后台跑一件事，把失败写进任务记录。
 *
 * 不 `await`——路由要立即返回。异常必须自己接住：Next 不会替我们保留一个游离的
 * rejected promise 的上下文，吞掉就只剩一个假死的任务。
 */
function inBackground(jobId: string, task: () => Promise<void>): void {
  void task().catch(async (error: unknown) => {
    const message = (error as Error)?.message ?? "未知错误";
    try {
      // 老师主动取消时，被杀的进程会以非 0 退出——那不是失败，别把状态改回去。
      const current = await readJob(jobId).catch(() => null);
      if (current?.status === "cancelled") return;
      await patchJob(jobId, {
        status: "failed",
        stage: "失败",
        message,
        pid: undefined,
        finishedAt: new Date().toISOString(),
      });
    } catch {
      // 连状态都写不进去（工作区没了）：到此为止，别再抛
    }
  });
}

/** 把上游产物归一化进工作区，并把任务推进到「待核对」。 */
async function normalizeJob(
  job: OcrJobRecord,
  upstreamDir: string,
  options: { method?: string | null; language?: string | null; logTail?: string[] } = {},
): Promise<void> {
  await patchJob(job.id, { status: "normalizing", stage: "整理识别结果" });
  const upstream = await locateUpstream(upstreamDir, options.method ?? DEFAULT_MINERU_OPTIONS.method);
  const contentList = JSON.parse(await readFile(upstream.contentListPath, "utf8")) as ContentListBlock[];
  const middle = JSON.parse(await readFile(upstream.middlePath, "utf8")) as MiddleFile;
  if (!Array.isArray(contentList)) {
    throw new OcrError("上游 content_list.json 不是数组，无法归一化");
  }
  const { manifest } = await normalizeIntoWorkspace({
    job,
    upstreamDir: upstream.dir,
    contentList,
    middle,
    originPdfPath: upstream.originPdfPath || undefined,
    imagesDir: upstream.imagesDir,
    method: options.method ?? DEFAULT_MINERU_OPTIONS.method,
    language: options.language ?? DEFAULT_MINERU_OPTIONS.language,
    pageImages: DEFAULT_PAGE_IMAGE,
    logTail: options.logTail,
  });
  await patchJob(job.id, {
    status: "ready",
    stage: "待核对",
    pagesDone: manifest.pageCount,
    pagesTotal: manifest.pageCount,
    pid: undefined,
    finishedAt: new Date().toISOString(),
  });
}

/**
 * 新建一次识别任务（原文件已经由路由流式写进 `sources/originals/`）。
 */
export async function startRecognition(input: {
  projectId: string;
  bookType: BookType;
  originalName: string;
  originalPath: string;
  originalBytes?: number;
}): Promise<OcrJobRecord> {
  const ready = await checkMineru();
  if (!ready.ready) throw new OcrError(ready.reason ?? "OCR 引擎不可用");

  const job = await createJob({
    projectId: input.projectId,
    bookType: input.bookType,
    originalName: assertImportable(input.originalName),
    originalPath: input.originalPath,
  });

  inBackground(job.id, async () => {
    const outDir = await mkdtemp(join(tmpdir(), `ocr-${job.id.slice(0, 8)}-`));
    // 页数以 PDF 为准：上游日志的进度条里混着区域数，不能当页数用
    const pageCount = await countPdfPages(input.originalPath, mineruPython());
    if (pageCount != null) {
      await patchJob(job.id, { pagesTotal: pageCount, pagesDone: 0 }).catch(() => undefined);
    }
    let lastProgress = "";
    const handle = spawnMineru({
      pdfPath: input.originalPath,
      outDir,
      options: DEFAULT_MINERU_OPTIONS,
      expectedPages: pageCount,
      onProgress: (progress) => {
        const key = `${progress.done}/${progress.total}`;
        if (key === lastProgress) return;
        lastProgress = key;
        // 进度写入失败不该打断识别本身
        const total = pageCount ?? progress.total;
        const done = progress.done == null ? null : Math.min(progress.done, total);
        void patchJob(job.id, {
          ...(done != null ? { pagesDone: done } : {}),
          pagesTotal: total,
          stage:
            done != null ? `识别中 ${done}/${total} 页` : `识别中（共 ${total} 页）`,
        }).catch(() => undefined);
      },
    });
    running.set(job.id, handle);
    await patchJob(job.id, {
      status: "running",
      pid: handle.pid,
      stage: "识别中",
      startedAt: new Date().toISOString(),
    });
    try {
      await handle.done;
      const logTail = handle.logTail();
      // 先把上游日志落到任务记录：失败时这是唯一的线索
      await patchJob(job.id, { logTail });
      await normalizeJob(job, outDir, { logTail });
      // 成功才清理上游产物（约 750 MB）；失败时留着，重试可直接复用
      await rm(outDir, { recursive: true, force: true });
    } catch (error) {
      await patchJob(job.id, { logTail: handle.logTail() }).catch(() => undefined);
      throw error;
    } finally {
      running.delete(job.id);
    }
  });

  return job;
}

/**
 * 导入**已经跑过的**上游产物（不重新识别）。
 *
 * PRODUCT.md §4.1 的主操作第一条就是"选择 PDF、图片或**已处理资料**"；
 * 老师手上已有的 `_mineru-full` 目录走这条路立刻可用。
 */
export async function startImport(input: {
  projectId: string;
  bookType: BookType;
  upstreamDir: string;
  /** 原始 PDF；不给就用上游的 `_origin.pdf`。 */
  originalPath?: string;
  originalName?: string;
  method?: string | null;
  language?: string | null;
}): Promise<OcrJobRecord> {
  // 目录不对是**老师的输入问题**，翻译成领域错误让路由给 400 + 可读提示
  const upstream = await locateUpstream(
    input.upstreamDir,
    input.method ?? DEFAULT_MINERU_OPTIONS.method,
  ).catch((error: unknown) => {
    throw new OcrError((error as Error).message);
  });
  const sourcePath = input.originalPath ?? upstream.originPdfPath;
  if (!sourcePath) throw new OcrError("上游没有 _origin.pdf，请指定原始 PDF 路径");

  const originalName = assertImportable(
    input.originalName ?? sourcePath.split(/[/\\]/).pop() ?? "source.pdf",
  );
  const job = await createJob({
    projectId: input.projectId,
    bookType: input.bookType,
    originalName,
    originalPath: joinPath(originalsDir(input.projectId), originalName),
  });
  // 原件只复制不改写（走工作区原语，与上传路径同一套校验）
  await copyIntoWorkspace(sourcePath, job.originalPath);

  inBackground(job.id, () => normalizeJob(job, input.upstreamDir, {
    method: input.method ?? DEFAULT_MINERU_OPTIONS.method,
    language: input.language ?? DEFAULT_MINERU_OPTIONS.language,
  }));

  return job;
}

/** 取消：杀进程树，保留原文件与日志。 */
export async function cancelJob(jobId: string): Promise<OcrJobRecord> {
  const job = await readJob(jobId);
  // 确认状态的事实源是 manifest（任务记录只管这次运行的过程）
  const manifest = await readManifest(job.projectId, jobId).catch(() => null);
  if (manifest?.status === "confirmed") throw new OcrError("已确认的来源不能取消");
  const handle = running.get(jobId);
  if (handle) {
    handle.cancel();
    running.delete(jobId);
  } else {
    // 服务重启后的遗留任务：进程可能还活着，按 pid 再杀一次
    cancelProcessTree(job.pid);
  }
  return patchJob(jobId, {
    status: "cancelled",
    stage: "已取消",
    message: "已取消识别。原文件已保留，可以重新识别。",
    pid: undefined,
    finishedAt: new Date().toISOString(),
  });
}

/** 重试：用同一份原件重跑一次（进度与产物都会重写）。 */
export async function retryJob(jobId: string): Promise<OcrJobRecord> {
  const job = await readJob(jobId);
  const manifest = await readManifest(job.projectId, jobId).catch(() => null);
  if (manifest?.status === "confirmed") throw new OcrError("已确认的来源不需要重新识别");
  if (job.status === "running" || job.status === "normalizing") {
    throw new OcrError("任务正在运行中");
  }
  const ready = await checkMineru();
  if (!ready.ready) throw new OcrError(ready.reason ?? "OCR 引擎不可用");

  await patchJob(jobId, { status: "queued", stage: "待识别", message: undefined, logTail: [] });
  inBackground(jobId, async () => {
    const outDir = await mkdtemp(join(tmpdir(), `ocr-${jobId.slice(0, 8)}-`));
    const handle = spawnMineru({
      pdfPath: job.originalPath,
      outDir,
      options: DEFAULT_MINERU_OPTIONS,
    });
    running.set(jobId, handle);
    await patchJob(jobId, {
      status: "running",
      pid: handle.pid,
      stage: "识别中",
      startedAt: new Date().toISOString(),
    });
    try {
      await handle.done;
      const logTail = handle.logTail();
      await patchJob(jobId, { logTail });
      await normalizeJob(job, outDir, { logTail });
      await rm(outDir, { recursive: true, force: true });
    } catch (error) {
      await patchJob(jobId, { logTail: handle.logTail() }).catch(() => undefined);
      throw error;
    } finally {
      running.delete(jobId);
    }
  });
  return readJob(jobId);
}

/** 引擎自检（界面用）。 */
export async function engineStatus(): Promise<{ ready: boolean; reason?: string }> {
  return checkMineru();
}

export { mineruPython, storeOriginal };
