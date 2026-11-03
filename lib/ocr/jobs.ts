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
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { copyDirFiles, copyIntoWorkspace, readBinary, writeBinaryAtomic } from "../workspace/files.ts";
import { listDir, readJson, readJsonDir, updateJson, writeJson } from "../workspace/json.ts";
import { jobFile, jobsDir, legacyOcrDir, legacyOcrJobDir, ocrFailureLog, ocrJobDir, ocrLibraryDir, originalsDir, safeSegment } from "../workspace/paths.ts";
import { allocateLibraryDirName, detectTerm, normalizeTerm } from "./naming.ts";
import { createLibraryDir, existingLibraryDirNames } from "./naming-disk.ts";
import { cancelProcessTree, isProcessAlive, mineruPython } from "./mineru.ts";
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
  /** 老师选的学期；没给就从文件名认，认不出用 winter。 */
  term?: string;
}): Promise<OcrJobRecord> {
  const now = new Date().toISOString();
  const term = normalizeTerm(input.term) ?? detectTerm(input.originalName) ?? "winter";
  // 文件夹随任务一起建出来：老师导入后就能在资料库里看到位置；失败时连目录一起清掉
  const dirName = await createLibraryDir(term, input.bookType);
  const record: OcrJobRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    bookType: input.bookType,
    term,
    dirName,
    status: "queued",
    originalPath: input.originalPath,
    originalName: input.originalName,
    stage: "待识别",
    pagesDone: null,
    pagesTotal: null,
    ownerPid: process.pid,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(jobFile(record.id), record);
  return record;
}

/** 给还没有资料库文件夹名的旧记录补一个（恢复中的任务在整理前调用）。 */
export async function ensureJobLibraryDir(record: OcrJobRecord): Promise<OcrJobRecord> {
  if (record.dirName) return record;
  const term = normalizeTerm(record.term) ?? detectTerm(record.originalName) ?? "winter";
  const dirName = await allocateLibraryDirName(term, record.bookType, await existingLibraryDirNames());
  await mkdir(ocrJobDir(dirName), { recursive: true });
  return patchJob(record.id, { term, dirName });
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
    // `.app/jobs` 是**共用**目录：审校任务也写在这里。只看带 bookType 的 OCR 记录，
    // 否则审校任务会出现在识别列表里（originalName 为空），上限清理还可能把它们删掉。
    if (!record.bookType) continue;
    if (record.status === "running" || record.status === "queued" || record.status === "normalizing") {
      // 本进程创建的任务还在自己手里（可能在等 MinerU，也可能在整理结果）——不算陈旧
      if (record.ownerPid === process.pid) {
        repaired.push(record);
        continue;
      }
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

/**
 * 删掉一个任务：**杀进程 → 记原因 → 删产物 → 删记录**。
 *
 * 产品口径（2026-10-21）：只有识别成功的书目留在任务列表里；失败、中断、取消的
 * 一律清理干净，老师重新导入即可。OCR 的上游产物动辄几百 MB，留着不只是"多一条记录"，
 * 会连同页图和临时文件一起占满工作区。
 */
export async function deleteJob(jobId: string, reason: string): Promise<void> {
  const record = await readJob(jobId).catch(() => null);
  if (!record) return;

  // 1) 还在跑的进程必须先杀（Windows 要杀进程树，否则留下 mineru-api 孤儿）
  if (record.pid) cancelProcessTree(record.pid);

  // 2) 任务记录马上要删，失败原因单独留一行日志，排查时还有线索
  try {
    await mkdir(dirname(ocrFailureLog()), { recursive: true });
    await appendFile(
      ocrFailureLog(),
      `${new Date().toISOString()}	${record.originalName ?? record.id}	${record.status}	${reason.replace(/\s+/gu, " ").slice(0, 400)}
`,
      "utf8",
    );
  } catch {
    // 写不了日志不影响清理
  }

  // 3) 产物：识别结果 + 上游临时产物
  await rm(ocrJobDir(record.dirName ?? jobId), { recursive: true, force: true }).catch(() => undefined);
  // 迁移前的老位置也清掉（还没迁移的任务，产物仍在 UUID 目录里）
  await rm(legacyOcrJobDir(record.projectId, jobId), { recursive: true, force: true }).catch(() => undefined);
  if (record.upstreamDir) {
    await rm(record.upstreamDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // 4) 记录
  await rm(jobFile(jobId), { force: true }).catch(() => undefined);

  // 5) 原件：没有别的任务再用同一个文件时才删（避免删掉已确认来源的原件）
  if (record.originalPath) {
    const remaining = await readJsonDir<OcrJobRecord>(jobsDir());
    const stillUsed = remaining.some((item) => item.originalPath === record.originalPath);
    if (!stillUsed) await rm(record.originalPath, { force: true }).catch(() => undefined);
  }
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
  /** 自定义产物目录（资料库 OCR 用）；不传仍写 OCR 资料库目录。 */
  jobDir?: string;
}): Promise<NormalizeResult> {
  const jobDir = input.jobDir ?? ocrJobDir(input.job.dirName ?? input.job.id);
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
    term: input.job.term,
    dirName: input.job.dirName,
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

/** 产物目录由任务记录决定（资料库文件夹名），不再由项目目录拼出来。 */
export async function jobDirOf(jobId: string): Promise<string> {
  const record = await readJob(jobId);
  return ocrJobDir(record.dirName ?? record.id);
}

export async function readManifest(jobId: string): Promise<OcrManifest> {
  const manifest = await readJson<OcrManifest | null>(
    join(await jobDirOf(jobId), "manifest.json"),
    null,
  );
  if (!manifest) throw new OcrError(`任务 ${jobId} 还没有产物`);
  return manifest;
}

export async function readContent(jobId: string): Promise<string> {
  const buffer = await readBinary(join(await jobDirOf(jobId), "content.md"));
  if (!buffer) throw new OcrError(`任务 ${jobId} 还没有 content.md`);
  return buffer.toString("utf8");
}

/** 老师的修订：写回 `content.md`（确认前可反复改）。 */
export async function saveContent(jobId: string, markdown: string): Promise<void> {
  const dir = await jobDirOf(jobId);
  const manifest = await readManifest(jobId);
  if (manifest.status === "confirmed") {
    throw new OcrError("已确认的来源不能再改；请新建一次识别任务");
  }
  await writeBinaryAtomic(join(dir, "content.md"), Buffer.from(markdown, "utf8"));
  await writeJson(join(dir, "manifest.json"), {
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
  jobId: string;
  confirmedBy?: string;
}): Promise<OcrManifest> {
  const dir = await jobDirOf(input.jobId);
  const manifest = await readManifest(input.jobId);
  if (manifest.status === "confirmed") return manifest;
  const now = new Date().toISOString();
  const updated: OcrManifest = {
    ...manifest,
    status: "confirmed",
    confirmedAt: now,
    confirmedBy: input.confirmedBy?.trim() || "teacher",
    updatedAt: now,
  };
  await writeJson(join(dir, "manifest.json"), updated);
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
  const manifest = await readManifest(record.id).catch(() => null);
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

/**
 * 已确认的来源清单（制作页下拉用）。扫资料库目录，不维护第二份索引。
 *
 * 同时扫迁移前的老位置：老师先打开制作页、还没打开识别页时，迁移可能还没跑，
 * 不能因此把已确认的来源漏掉（按 `jobId` 去重）。
 */
export async function listConfirmedSources(filter: {
  projectId?: string;
  bookType?: BookType;
} = {}): Promise<OcrSourceSummary[]> {
  const summaries: OcrSourceSummary[] = [];
  const seen = new Set<string>();
  const collect = async (dirName: string, dir: string): Promise<void> => {
    const manifest = await readJson<OcrManifest | null>(join(dir, "manifest.json"), null);
    if (!manifest || manifest.status !== "confirmed") return;
    if (seen.has(manifest.jobId)) return;
    seen.add(manifest.jobId);
    if (filter.projectId && manifest.projectId !== filter.projectId) return;
    if (filter.bookType && manifest.bookType !== filter.bookType) return;
    summaries.push({
      jobId: manifest.jobId,
      dirName: manifest.dirName ?? dirName,
      projectId: manifest.projectId,
      bookType: manifest.bookType,
      originalName: manifest.originalName,
      pageCount: manifest.pageCount,
      confirmedAt: manifest.confirmedAt ?? manifest.updatedAt,
    });
  };

  for (const dirName of await listDir(ocrLibraryDir())) {
    await collect(dirName, ocrJobDir(dirName));
  }
  const projectIds = (await (await import("../db/store.ts")).getAppStore().listProjects()).map(
    (project) => project.id,
  );
  for (const projectId of projectIds) {
    for (const jobId of await listDir(legacyOcrDir(projectId))) {
      if (seen.has(jobId)) continue;
      await collect(jobId, legacyOcrJobDir(projectId, jobId));
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
export async function jobFiles(jobId: string): Promise<string[]> {
  return listDir(await jobDirOf(jobId));
}

/** 读 `structure.json`。 */
export async function readStructure(jobId: string): Promise<OcrStructure> {
  const structure = await readJson<OcrStructure | null>(
    join(await jobDirOf(jobId), "structure.json"),
    null,
  );
  if (!structure) throw new OcrError(`任务 ${jobId} 还没有 structure.json`);
  return structure;
}

/** 读 `diagnostics.json`（失败原因、上游日志尾部）。 */
export async function readDiagnostics(jobId: string): Promise<unknown> {
  const raw = await readBinary(join(await jobDirOf(jobId), "diagnostics.json"));
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
