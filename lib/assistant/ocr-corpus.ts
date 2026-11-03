/**
 * 已确认 OCR 教材 → 通用助手检索语料。
 *
 * 只读 `document/ocr/<dir>/` 的实际产物，不依赖 `.app/jobs` 任务记录：
 * 任务记录是可重建的，而老师确认过的教材正文、结构 JSON 和页图是资料库事实源。
 *
 * 页面证据分两层：
 * - `content.md` 的页码标记决定“命中在哪一页”；
 * - `structure.json` 的块坐标决定“页内哪个区域”，拿不到就只定位到页，不伪造框。
 */

import { join } from "node:path";
import { listDir, readJson } from "../workspace/json.ts";
import { readBinary } from "../workspace/files.ts";
import { ocrLibraryDir } from "../workspace/paths.ts";
import { pageImageName } from "../ocr/page-names.ts";
import type { OcrBlock, OcrManifest, OcrStructure } from "../ocr/types.ts";
import type { AssistantQuery } from "./types.ts";
import { htmlToText, normalizeBox, parseContentPages } from "./text.ts";

export type OcrCorpusDoc = {
  jobId: string;
  dirName: string;
  projectId: string;
  bookType: string;
  documentName: string;
  pageCount: number;
  /** 0 基页码 → 可检索正文（HTML 表格已转纯文本）。 */
  pages: Map<number, string>;
  blocks: OcrBlock[];
};

export type OcrCorpusResult = {
  docs: OcrCorpusDoc[];
  sourceCount: number;
  gaps: string[];
};

const MAX_SCAN_CHARS = 200_000;

function manifestKey(manifest: OcrManifest): string {
  return [manifest.projectId, manifest.bookType, manifest.originalName.toLocaleLowerCase(), manifest.pageCount].join("|");
}

function pagesFromBlocks(structure: OcrStructure | null): Map<number, string> {
  const pages = new Map<number, string>();
  for (const block of structure?.blocks ?? []) {
    const text = block.text?.trim() || (block.html ? htmlToText(block.html) : "");
    if (!text) continue;
    pages.set(block.pageIndex, `${pages.get(block.pageIndex) ?? ""}${text}\n`);
  }
  return pages;
}

/**
 * 扫描已确认 OCR 目录。损坏目录跳过并记入 gaps，不阻断其它来源。
 *
 * 同一本书被导入两次（如 `winter-sb-ocr` 与 `winter-sb-ocr-2`）时保留
 * confirmedAt/updatedAt 最新的一份，避免通用助手给出重复命中。
 */
export async function collectOcrCorpus(query: Pick<AssistantQuery, "scope" | "projectId" | "bookType">): Promise<OcrCorpusResult> {
  const gaps: string[] = [];
  const candidates: Array<{ manifest: OcrManifest; dirName: string; content: string; structure: OcrStructure | null }> = [];

  for (const dirName of (await listDir(ocrLibraryDir())).sort()) {
    const dir = join(ocrLibraryDir(), dirName);
    let manifest: OcrManifest | null;
    try {
      manifest = await readJson<OcrManifest | null>(join(dir, "manifest.json"), null);
    } catch (error) {
      gaps.push(`OCR 目录 ${dirName} 的 manifest 损坏，未参与检索：${(error as Error).message}`);
      continue;
    }
    if (!manifest || manifest.status !== "confirmed") continue;
    if (query.scope === "project" && query.projectId && manifest.projectId !== query.projectId) continue;
    if (query.bookType && manifest.bookType !== query.bookType) continue;

    let content = "";
    try {
      content = (await readBinary(join(dir, "content.md")))?.toString("utf8") ?? "";
    } catch (error) {
      gaps.push(`OCR 目录 ${dirName} 的正文读取失败：${(error as Error).message}`);
      continue;
    }
    let structure: OcrStructure | null = null;
    try {
      structure = await readJson<OcrStructure | null>(join(dir, "structure.json"), null);
    } catch (error) {
      gaps.push(`OCR 目录 ${dirName} 的结构文件损坏，仅按正文定位页：${(error as Error).message}`);
    }
    candidates.push({ manifest, dirName, content: content.slice(0, MAX_SCAN_CHARS), structure });
  }

  // 同一本书的重复确认目录：保留最新的一份；同一 jobId 也去重。
  const byKey = new Map<string, (typeof candidates)[number]>();
  const seenJobs = new Set<string>();
  for (const item of candidates) {
    if (seenJobs.has(item.manifest.jobId)) continue;
    seenJobs.add(item.manifest.jobId);
    const key = manifestKey(item.manifest);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }
    const currentTime = current.manifest.confirmedAt ?? current.manifest.updatedAt ?? "";
    const itemTime = item.manifest.confirmedAt ?? item.manifest.updatedAt ?? "";
    if (itemTime > currentTime) {
      byKey.set(key, item);
      gaps.push(`同一本书有多个已确认 OCR 目录，已使用较新的 ${item.dirName}（忽略 ${current.dirName}）。`);
    } else {
      gaps.push(`同一本书有多个已确认 OCR 目录，已使用较新的 ${current.dirName}（忽略 ${item.dirName}）。`);
    }
  }

  const docs: OcrCorpusDoc[] = [];
  for (const item of byKey.values()) {
    const pages = item.content.trim() ? parseContentPages(item.content) : pagesFromBlocks(item.structure);
    if (pages.size === 0) {
      gaps.push(`OCR 目录 ${item.dirName} 没有可检索正文。`);
      continue;
    }
    const blocks = (item.structure?.blocks ?? []).filter((block) =>
      ["title", "text", "list", "table", "other", "aside", "code"].includes(block.type),
    );
    docs.push({
      jobId: item.manifest.jobId,
      dirName: item.dirName,
      projectId: item.manifest.projectId,
      bookType: item.manifest.bookType,
      documentName: item.manifest.originalName,
      pageCount: item.manifest.pageCount,
      pages,
      blocks,
    });
  }

  return { docs, sourceCount: docs.length, gaps };
}

/** 页图地址：稳定指向目录，不依赖任务记录是否还在。 */
export function ocrPageImageUrl(dirName: string, pageIndex: number): string {
  return `/api/ocr/library/${encodeURIComponent(dirName)}/pages/${pageImageName(pageIndex)}`;
}

/** 块的可检索文本：表格的正文在 `html`，不能只看 `text`。 */
export function blockSearchText(block: OcrBlock): string {
  return block.text?.trim() || (block.html ? htmlToText(block.html) : "");
}

export function blockBox(block: OcrBlock): ReturnType<typeof normalizeBox> {
  return normalizeBox(block.box);
}
