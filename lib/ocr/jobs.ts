/**
 * OCR 任务：状态、产物落盘与恢复。
 *
 * 分成两处存放，各有明确角色：
 * - `.app/jobs/<id>.json` —— **在跑任务的状态**，可重建、可丢弃；
 * - `projects/<id>/sources/ocr/<job-id>/` —— **产物**，一旦成功就是事实源。
 *
 * 老师确认前产物只是候选来源，不进生成（profile §5.1）。
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { copyDirFiles, copyIntoWorkspace, readBinary, writeBinaryAtomic } from "../workspace/files.ts";
import { listDir, readJson, readJsonDir, updateJson, writeJson } from "../workspace/json.ts";
import { jobFile, jobsDir, ocrDir, ocrJobDir, originalsDir, safeSegment } from "../workspace/paths.ts";
import { isProcessAlive, mineruPython } from "./mineru.ts";
import { countPdfPages } from "./pages.ts";
import {
  buildContentMarkdown,
  buildStructure,
  readEngineMeta,
  structureWarnings,
  type MiddleFile,
} from "./normalize.ts";
import {
  DEFAULT_PAGE_IMAGE,
  pageImageName,
  renderPageImages,
  type PageImageOptions,
} from "./pages.ts";
import {
  OcrError,
  type OcrJobRecord,
  type OcrJobStatus,
  type OcrManifest,
  type OcrSourceSummary,
  type OcrStructure,
} from "./types.ts";
import type { BookType } from "../db/types.ts";
import type { ContentListBlock } from "../knowledge/ocr-pages.ts";

/** 允许参与识别的书种——与模块目录一致。 */
const BOOK_TYPES: readonly string[] = ["student", "workbook", "knowledge", "vocab"];

export function assertBookType(value: unknown): BookType {
  if (typeof value !== "string" || !BOOK_TYPES.includes(value)) {
    throw new OcrError(`书种不受支持：${String(value)}`);
  }
  return value as BookType;
}

/** 允许导入的文件类型（按扩展名初筛，真正的判据是文件头）。 */
const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg"] as const;

export function assertImportable(fileName: string): string {
  const name = safeSegment(fileName.trim() || "未命名");
  const lower = name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new OcrError(`只接受 PDF 或图片：${name}`);
  }
  return name;
}

/** 单文件上限：实测学生用书 209 MB，留出余量。 */
export const MAX_ORIGINAL_BYTES = 512 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 任务状态
// ---------------------------------------------------------------------------

export async function createJob(input: {
  projectId: string;
  bookType: BookType;
  originalName: string;
  originalPath: string;
}): Promise<OcrJobRecord> {
  const now = new Date().toISOString();
  const record: OcrJobRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    bookType: input.bookType,
    status: "queued",
    originalPath: input.originalPath,
    originalName: input.originalName,
    stage: "待识别",
    pagesDone: null,
    pagesTotal: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(jobFile(record.id), record);
  return record;
}

export async function readJob(jobId: string): Promise<OcrJobRecord> {
  const record = await readJson<OcrJobRecord | null>(jobFile(jobId), null);
  if (!record) throw new OcrError(`任务不存在：${jobId}`);
  return record;
}

export async function patchJob(
  jobId: string,
  patch: Partial<OcrJobRecord>,
): Promise<OcrJobRecord> {
  return updateJson<OcrJobRecord | null>(
    jobFile(jobId),
    null,
    (current) => {
      if (!current) throw new OcrError(`任务不存在：${jobId}`);
      if (patch.status && !canTransition(current.status, patch.status)) {
        throw new OcrError(`已确认的任务不能再改回「${patch.status}」`);
      }
      return { ...current, ...patch, updatedAt: new Date().toISOString() };
    },
  ) as Promise<OcrJobRecord>;
}

/**
 * 列出任务，并**修正陈旧状态**。
 *
 * 服务重启后子进程会变成孤儿或已经死掉，而文件里还写着 `running`。
 * 不修正的话界面会一直转圈——所以这里按 pid 存活判定，改标 `interrupted`（可重新识别）。
 */
export async function listJobs(filter: { projectId?: string } = {}): Promise<OcrJobRecord[]> {
  const records = await readJsonDir<OcrJobRecord>(jobsDir());
  const alive = new Map<string, boolean>();
  const repaired: OcrJobRecord[] = [];
  for (let record of records) {
    if (!record || !record.id) continue;
    if (record.status === "running" || record.status === "queued" || record.status === "normalizing") {
      if (!alive.has(record.id)) alive.set(record.id, isProcessAlive(record.pid));
      if (!alive.get(record.id)) {
        const updated = await patchJob(record.id, {
          status: "interrupted",
          stage: "已中断",
          message: "识别过程被中断（应用或服务重启）。原文件已保留，可以重新识别。",
          pid: undefined,
          finishedAt: new Date().toISOString(),
        });
        repaired.push(updated);
        continue;
      }
    }
    // 中断任务的 stage 可能还停在旧进度字符串上；进度另有字段，这里改回状态词
    if (record.status === "interrupted" && record.stage?.startsWith("识别中")) {
      record = await patchJob(record.id, { stage: "已中断" });
    }
    // 旧记录里的页数来自上游日志（混着区域数，实测 83 页写成 1668 页）。
    // 终态任务做一次校正并打上来源标记，之后不再重复开 PDF。
    if (
      record.pagesTotal != null &&
      record.pagesSource !== "pdf" &&
      record.originalPath &&
      record.status !== "running" &&
      record.status !== "queued" &&
      record.status !== "normalizing"
    ) {
      const real = await countPdfPages(record.originalPath, mineruPython());
      if (real != null) {
        record =
          real === record.pagesTotal
            ? await patchJob(record.id, { pagesSource: "pdf" })
            : await patchJob(record.id, {
                pagesTotal: real,
                pagesDone:
                  record.pagesDone == null ? record.pagesDone : Math.min(record.pagesDone, real),
                pagesSource: "pdf",
                // 中断任务的 stage 还停在旧进度字符串上；进度另有字段，这里改回状态词
                ...(record.status === "interrupted" ? { stage: "已中断" } : {}),
              });
      }
    }
    repaired.push(record);
  }
  const filtered = filter.projectId
    ? repaired.filter((record) => record.projectId === filter.projectId)
    : repaired;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// 产物落盘
// ---------------------------------------------------------------------------

/** 把原文件复制进 `sources/originals/`（只复制不改写）。 */
export async function storeOriginal(
  projectId: string,
  originalName: string,
  sourcePath: string,
): Promise<{ path: string; bytes: number }> {
  const name = assertImportable(originalName);
  const target = join(originalsDir(projectId), name);
  const bytes = await copyIntoWorkspace(sourcePath, target);
  return { path: target, bytes };
}

export type NormalizeResult = {
  manifest: OcrManifest;
  structure: OcrStructure;
};

/**
 * 上游产物 → 工作区里的契约文件。
 *
 * 写 `manifest.json` / `content.md` / `structure.json` / `pages/` / `assets/` / `diagnostics.json`。
 * **不复制 `_layout.pdf` / `_span.pdf`**：学生用书这两份合计 544 MB，进工作区会撑爆。
 */
export async function normalizeIntoWorkspace(input: {
  job: OcrJobRecord;
  upstreamDir: string;
  contentList: ContentListBlock[];
  middle: MiddleFile;
  originPdfPath?: string;
  imagesDir?: string;
  method?: string | null;
  language?: string | null;
  pageImages?: PageImageOptions;
  /** 上游日志尾部，写进 diagnostics 供事后排查。 */
  logTail?: string[];
}): Promise<NormalizeResult> {
  const jobDir = ocrJobDir(input.job.projectId, input.job.id);
  const structure = buildStructure({
    jobId: input.job.id,
    contentList: input.contentList,
    middle: input.middle,
  });

  // 资产：`images/` → `assets/`（profile §3 的目录名）
  let assetCount = 0;
  if (input.imagesDir) {
    assetCount = (await copyDirFiles(input.imagesDir, join(jobDir, "assets"))).length;
  }

  // 页图：引擎不产出整页图，自己渲染（参数进 manifest，可重建）
  const pageImages = input.pageImages ?? DEFAULT_PAGE_IMAGE;
  const warnings = structureWarnings(structure, input.contentList);
  if (input.originPdfPath) {
    try {
      await renderPageImages({
        pythonExe: mineruPython(),
        pdfPath: input.originPdfPath,
        outDir: join(jobDir, "pages"),
        options: pageImages,
      });
    } catch (error) {
      warnings.push(`页图渲染失败：${(error as Error).message}`);
    }
  } else {
    warnings.push("上游没有 _origin.pdf，未能渲染整页页图");
  }

  const now = new Date().toISOString();
  const manifest: OcrManifest = {
    jobId: input.job.id,
    projectId: input.job.projectId,
    bookType: input.job.bookType,
    originalName: input.job.originalName,
    originalBytes: 0,
    status: "ready",
    engine: readEngineMeta(input.middle, { method: input.method, language: input.language }),
    pageCount: structure.pageCount,
    pages: pageImages,
    createdAt: input.job.createdAt,
    updatedAt: now,
    warnings,
  };

  await writeJson(join(jobDir, "manifest.json"), manifest);
  await writeJson(join(jobDir, "structure.json"), structure);
  await writeBinaryAtomic(
    join(jobDir, "content.md"),
    Buffer.from(buildContentMarkdown(input.contentList), "utf8"),
  );
  await writeJson(join(jobDir, "diagnostics.json"), {
    jobId: input.job.id,
    upstreamDir: input.upstreamDir,
    assets: assetCount,
    warnings,
    logTail: input.logTail ?? input.job.logTail ?? [],
  });

  return { manifest, structure };
}

// ---------------------------------------------------------------------------
// 读取与确认
// ---------------------------------------------------------------------------

export async function readManifest(projectId: string, jobId: string): Promise<OcrManifest> {
  const manifest = await readJson<OcrManifest | null>(
    join(ocrJobDir(projectId, jobId), "manifest.json"),
    null,
  );
  if (!manifest) throw new OcrError(`任务 ${jobId} 还没有产物`);
  return manifest;
}

export async function readContent(projectId: string, jobId: string): Promise<string> {
  const buffer = await readBinary(join(ocrJobDir(projectId, jobId), "content.md"));
  if (!buffer) throw new OcrError(`任务 ${jobId} 还没有 content.md`);
  return buffer.toString("utf8");
}

/** 老师的修订：写回 `content.md`（确认前可反复改）。 */
export async function saveContent(projectId: string, jobId: string, markdown: string): Promise<void> {
  const manifest = await readManifest(projectId, jobId);
  if (manifest.status === "confirmed") {
    throw new OcrError("已确认的来源不能再改；请新建一次识别任务");
  }
  await writeBinaryAtomic(
    join(ocrJobDir(projectId, jobId), "content.md"),
    Buffer.from(markdown, "utf8"),
  );
  await writeJson(join(ocrJobDir(projectId, jobId), "manifest.json"), {
    ...manifest,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 确认并加入资料库。
 *
 * 确认前 `manifest.status` 是 `ready`（待核对），确认后才是 `confirmed`——
 * 制作页只列 `confirmed` 的来源（profile §5.1：未经确认只能作候选）。
 */
export async function confirmJob(input: {
  projectId: string;
  jobId: string;
  confirmedBy?: string;
}): Promise<OcrManifest> {
  const manifest = await readManifest(input.projectId, input.jobId);
  if (manifest.status === "confirmed") return manifest;
  const now = new Date().toISOString();
  const updated: OcrManifest = {
    ...manifest,
    status: "confirmed",
    confirmedAt: now,
    confirmedBy: input.confirmedBy?.trim() || "teacher",
    updatedAt: now,
  };
  await writeJson(join(ocrJobDir(input.projectId, input.jobId), "manifest.json"), updated);
  return updated;
}

/**
 * 任务视图：任务状态 + 产物状态。
 *
 * 两者是不同的事实：「任务」是这次运行的过程（进度、失败原因、pid），
 * 「产物」是 OCR 结果本身（待核对 / 已确认）。老师看到的状态应当以**产物**为准——
 * 确认过的来源不能还显示成"待核对"，所以界面读这个合并视图。
 */
export type OcrJobView = OcrJobRecord & {
  manifest: {
    status: OcrJobStatus;
    pageCount: number;
    confirmedAt?: string;
    warnings: string[];
  } | null;
};

export async function toJobView(record: OcrJobRecord): Promise<OcrJobView> {
  const manifest = await readManifest(record.projectId, record.id).catch(() => null);
  return {
    ...record,
    manifest: manifest
      ? {
          status: manifest.status,
          pageCount: manifest.pageCount,
          confirmedAt: manifest.confirmedAt,
          warnings: manifest.warnings ?? [],
        }
      : null,
  };
}

export async function listJobViews(filter: { projectId?: string } = {}): Promise<OcrJobView[]> {
  const records = await listJobs(filter);
  return Promise.all(records.map((record) => toJobView(record)));
}

/** 老师看到的最终状态：有产物就以产物为准。 */
export function effectiveStatus(view: OcrJobView): OcrJobStatus {
  return view.manifest?.status ?? view.status;
}

/** 已确认的来源清单（制作页下拉用）。扫目录，不维护第二份索引。 */
export async function listConfirmedSources(filter: {
  /** 不给就列整个工作区——老师不需要按项目切换。 */
  projectId?: string;
  bookType?: BookType;
}): Promise<OcrSourceSummary[]> {
  const projectIds = filter.projectId
    ? [filter.projectId]
    : (await (await import("../db/store.ts")).getAppStore().listProjects()).map((project) => project.id);
  const summaries: OcrSourceSummary[] = [];
  for (const projectId of projectIds) {
    for (const name of await listDir(ocrDir(projectId))) {
      const manifest = await readJson<OcrManifest | null>(
        join(ocrJobDir(projectId, name), "manifest.json"),
        null,
      );
      if (!manifest || manifest.status !== "confirmed") continue;
      if (filter.bookType && manifest.bookType !== filter.bookType) continue;
      summaries.push({
        jobId: manifest.jobId,
        projectId: manifest.projectId,
        bookType: manifest.bookType,
        originalName: manifest.originalName,
        pageCount: manifest.pageCount,
        confirmedAt: manifest.confirmedAt ?? manifest.updatedAt,
      });
    }
  }
  return summaries.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

/** 页图文件名（界面按页取图）。 */
export { pageImageName };

/** 读原文件字节（原件在 sources/originals 里，只读）。 */
export async function readOriginal(projectId: string, name: string): Promise<Buffer | null> {
  return readBinary(join(originalsDir(projectId), safeSegment(name)));
}

/** 供诊断：任务目录里的文件清单。 */
export async function jobFiles(projectId: string, jobId: string): Promise<string[]> {
  return listDir(ocrJobDir(projectId, jobId));
}

/** 读 `structure.json`。 */
export async function readStructure(projectId: string, jobId: string): Promise<OcrStructure> {
  const structure = await readJson<OcrStructure | null>(
    join(ocrJobDir(projectId, jobId), "structure.json"),
    null,
  );
  if (!structure) throw new OcrError(`任务 ${jobId} 还没有 structure.json`);
  return structure;
}

/** 读 `diagnostics.json`（失败原因、上游日志尾部）。 */
export async function readDiagnostics(projectId: string, jobId: string): Promise<unknown> {
  const raw = await readBinary(join(ocrJobDir(projectId, jobId), "diagnostics.json"));
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * 状态迁移只守一条不变量：**已确认是终态**。
 *
 * 不搞全局顺序表——`ready → normalizing`（页图渲染失败后重跑）这类回退是合法的，
 * 用顺序表会把它挡掉。真正不能发生的是"把老师确认过的来源退回待核对"，
 * 那会让已经进过生成的来源悄悄变回候选。
 */
export function canTransition(from: OcrJobStatus, to: OcrJobStatus): boolean {
  return from === "confirmed" ? to === "confirmed" : true;
}

/** 直接读原文件（供导入已有产物时校验存在性）。 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
