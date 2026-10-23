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

import { mkdir, readFile, rm } from "node:fs/promises";
import type { BookType } from "../db/types.ts";
import { copyIntoWorkspace } from "../workspace/files.ts";
import { ocrUpstreamDir, originalsDir } from "../workspace/paths.ts";
import { join as joinPath } from "node:path";
import {
  assertImportable,
  createJob,
  deleteJob,
  ensureJobLibraryDir,
  listJobs,
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
  isProcessAlive,
  type MineruHandle,
} from "./mineru.ts";
import { countPdfPages } from "./pages.ts";
import type { ContentListBlock } from "../knowledge/ocr-pages.ts";
import type { MiddleFile } from "./normalize.ts";
import { OcrError, type OcrJobRecord } from "./types.ts";
import { DEFAULT_PAGE_IMAGE } from "./pages.ts";
import { ensureOcrLibraryLayout } from "./library.ts";

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
      // 老师主动取消时，记录已被清理掉；这里读不到就说明已经处理过了。
      const current = await readJob(jobId).catch(() => null);
      if (!current) return;
      // 失败不留记录，也不留产物：杀进程 + 删页图/临时文件，老师重新导入即可
      await deleteJob(jobId, message);
    } catch {
      // 连清理都做不了（工作区没了）：到此为止，别再抛
    }
  });
}

/** 把上游产物归一化进工作区，并把任务推进到「待核对」。 */
async function normalizeJob(
  input: OcrJobRecord,
  upstreamDir: string,
  options: { method?: string | null; language?: string | null; logTail?: string[] } = {},
): Promise<void> {
  // 旧记录（升级前创建、重启后续跑）没有资料库文件夹名，先补上再落盘
  const job = await ensureJobLibraryDir(input);
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
 * 跑一次 MinerU：进度写进任务记录，成功后归一化。
 *
 * 上游产物写在**稳定目录**（`<ws>/.app/ocr-upstream/<jobId>/`）而不是系统临时目录：
 * 应用重启后还能接着整理，不必整本重跑。
 */
async function recognizeInto(job: OcrJobRecord): Promise<void> {
  const outDir = job.upstreamDir ?? ocrUpstreamDir(job.id);
  await mkdir(outDir, { recursive: true });
  if (!job.upstreamDir) await patchJob(job.id, { upstreamDir: outDir }).catch(() => undefined);

  // 页数以 PDF 为准：上游日志的进度条里混着区域数，不能当页数用
  const pageCount = await countPdfPages(job.originalPath, mineruPython());
  if (pageCount != null) {
    await patchJob(job.id, { pagesTotal: pageCount, pagesDone: 0, pagesSource: "pdf" }).catch(() => undefined);
  }

  let lastProgress = "";
  const handle = spawnMineru({
    pdfPath: job.originalPath,
    outDir,
    options: DEFAULT_MINERU_OPTIONS,
    expectedPages: pageCount,
    onProgress: (progress) => {
      const key =
        progress.kind === "pages"
          ? `pages:${progress.done}/${progress.total}`
          : `phase:${progress.label}:${progress.percent}`;
      if (key === lastProgress) return;
      lastProgress = key;
      // 页级阶段报页数；其它阶段（文字识别等）只报百分比——**不能**当页数，
      // 否则 83 页的书会显示成 1668 页，或者被丢弃后一直停在 0/83。
      const patch =
        progress.kind === "pages"
          ? {
              ...(progress.done != null ? { pagesDone: progress.done } : {}),
              pagesTotal: progress.total,
              stage:
                progress.done != null
                  ? `识别中 ${progress.done}/${progress.total} 页`
                  : `识别中（共 ${progress.total} 页）`,
            }
          : { stage: `识别中 · ${progress.label} ${progress.percent}%` };
      // 进度写入失败不该打断识别本身
      void patchJob(job.id, patch).catch(() => undefined);
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
    // 成功才清理上游产物（几百 MB）
    await rm(outDir, { recursive: true, force: true });
  } catch (error) {
    await patchJob(job.id, { logTail: handle.logTail() }).catch(() => undefined);
    throw error;
  } finally {
    running.delete(job.id);
  }
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
  /** 学期：决定资料库文件夹名（spring-sb-ocr）。 */
  term?: string;
}): Promise<OcrJobRecord> {
  const ready = await checkMineru();
  if (!ready.ready) throw new OcrError(ready.reason ?? "OCR 引擎不可用");

  const job = await createJob({
    projectId: input.projectId,
    bookType: input.bookType,
    originalName: assertImportable(input.originalName),
    originalPath: input.originalPath,
    term: input.term,
  });

  inBackground(job.id, () => recognizeInto(job));

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
  term?: string;
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
    term: input.term,
  });
  // 原件只复制不改写（走工作区原语，与上传路径同一套校验）
  await copyIntoWorkspace(sourcePath, job.originalPath);

  inBackground(job.id, () => normalizeJob(job, input.upstreamDir, {
    method: input.method ?? DEFAULT_MINERU_OPTIONS.method,
    language: input.language ?? DEFAULT_MINERU_OPTIONS.language,
  }));

  return job;
}

/**
 * 取消：**杀进程并清理**。
 *
 * 产品口径（2026-10-21）：取消/失败/中断都不留任务记录和产物；
 * 老师重新导入 PDF 即可。已确认的来源不能取消（那是资料库事实源）。
 */
export async function cancelJob(jobId: string): Promise<OcrJobRecord> {
  const job = await readJob(jobId);
  // 确认状态的事实源是 manifest（任务记录只管这次运行的过程）
  const manifest = await readManifest(jobId).catch(() => null);
  if (manifest?.status === "confirmed") throw new OcrError("已确认的来源不能取消");
  const handle = running.get(jobId);
  if (handle) {
    handle.cancel();
    running.delete(jobId);
  } else {
    // 服务重启后的遗留任务：进程可能还活着，按 pid 再杀一次
    cancelProcessTree(job.pid);
  }
  await deleteJob(jobId, "老师取消了识别");
  const now = new Date().toISOString();
  return { ...job, status: "cancelled", stage: "已取消", pid: undefined, finishedAt: now, updatedAt: now };
}

/** 重试：用同一份原件重跑一次（进度与产物都会重写）。 */
export async function retryJob(jobId: string): Promise<OcrJobRecord> {
  const job = await readJob(jobId);
  const manifest = await readManifest(jobId).catch(() => null);
  if (manifest?.status === "confirmed") throw new OcrError("已确认的来源不需要重新识别");
  if (job.status === "running" || job.status === "normalizing") {
    throw new OcrError("任务正在运行中");
  }
  const ready = await checkMineru();
  if (!ready.ready) throw new OcrError(ready.reason ?? "OCR 引擎不可用");

  await patchJob(jobId, { status: "queued", stage: "待识别", message: undefined, logTail: [] });
  inBackground(jobId, () => recognizeInto(job));
  return readJob(jobId);
}

/** 引擎自检（界面用）。 */
export async function engineStatus(): Promise<{ ready: boolean; reason?: string }> {
  return checkMineru();
}

export { mineruPython, storeOriginal };

/**
 * 回收与恢复：每次打开识别页时跑一次（限流 5 秒）。
 *
 * 三件事，对应产品口径（2026-10-21）：
 * 1. **失败/中断/取消的任务全部清理**（杀进程、删页图与临时产物、删记录）；
 * 2. **重启后能接着跑**：上游产物在稳定目录里，进程还活着就等它，跑完了直接整理；
 * 3. **最多保留 10 条记录**（已确认的来源是资料库事实源，永不自动删）。
 */
const resuming = new Set<string>();
let lastReconcile = 0;

export async function reconcileOcrJobs(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastReconcile < 5000) return;
  lastReconcile = now;

  // 旧版本的产物目录是 UUID：先迁到可读的资料库文件夹（幂等、每个进程一次）
  await ensureOcrLibraryLayout();
  const records = await listJobs();
  for (const record of records) {
    // 本进程创建的任务由本进程负责：它可能刚建好、正在读页数/启动引擎，
    // 此时没有 pid 也没有句柄——不能当成"陈旧"删掉（实测会把刚上传的原件一起删）。
    if (record.ownerPid === process.pid) continue;
    if (running.has(record.id) || resuming.has(record.id)) continue;

    if (record.status === "failed" || record.status === "interrupted" || record.status === "cancelled") {
      // 中断但**上游产物已经跑完**：接着整理比让老师重跑 5 分钟更划算
      if (record.status === "interrupted" && (await upstreamComplete(record))) {
        void finishResumed(record);
        continue;
      }
      await deleteJob(record.id, `任务${record.status}，自动清理`);
      continue;
    }
    if (record.status !== "running" && record.status !== "queued" && record.status !== "normalizing") continue;

    // 运行中但没有句柄 = 应用重启后的遗留任务
    if (record.pid != null && isProcessAlive(record.pid)) {
      watchResumed(record);
      continue;
    }
    // 进程没了：上游产物齐全就接着整理，否则清理
    if (await upstreamComplete(record)) {
      void finishResumed(record);
    } else {
      await deleteJob(record.id, "识别中断（进程已退出且没有可复用的产物）");
    }
  }
  await capJobRecords();
}

async function upstreamComplete(record: OcrJobRecord): Promise<boolean> {
  if (!record.upstreamDir) return false;
  try {
    const upstream = await locateUpstream(record.upstreamDir, DEFAULT_MINERU_OPTIONS.method);
    return Boolean(upstream.contentListPath && upstream.middlePath);
  } catch {
    return false;
  }
}

/** 进程还活着：每 2 秒看一眼，退出后接着整理。 */
function watchResumed(record: OcrJobRecord): void {
  resuming.add(record.id);
  const timer = setInterval(async () => {
    if (isProcessAlive(record.pid)) return;
    clearInterval(timer);
    resuming.delete(record.id);
    const latest = await readJob(record.id).catch(() => null);
    if (latest) await finishResumed(latest);
  }, 2000);
  timer.unref?.();
}

/** 把重启前跑完/刚跑完的上游产物整理进工作区；失败就清理。 */
async function finishResumed(record: OcrJobRecord): Promise<void> {
  if (!record.upstreamDir) {
    await deleteJob(record.id, "没有可复用的上游产物");
    return;
  }
  try {
    await normalizeJob(record, record.upstreamDir, { logTail: record.logTail ?? [] });
    await rm(record.upstreamDir, { recursive: true, force: true });
  } catch (error) {
    await deleteJob(record.id, `恢复识别失败：${(error as Error).message}`);
  }
}

/** 最多保留 10 条记录；超出时从**未确认**的最旧记录开始清。 */
async function capJobRecords(limit = 10): Promise<void> {
  const records = await listJobs();
  let overflow = records.length - limit;
  if (overflow <= 0) return;
  const oldestFirst = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const record of oldestFirst) {
    if (overflow <= 0) break;
    const manifest = await readManifest(record.id).catch(() => null);
    if (manifest?.status === "confirmed") continue; // 资料库事实源，永不自动删
    await deleteJob(record.id, `识别记录超过 ${limit} 条，自动清理较早的记录`);
    overflow -= 1;
  }
}
