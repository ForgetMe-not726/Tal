/**
 * 资料库扫描件的本机 OCR 队列。
 *
 * 复用资料识别已经验证过的 MinerU 适配与归一化逻辑；产物落在 `.app/retrieval/`
 * （可重建），原件仍在 `document/library/<item>/files/`。队列串行，避免多个
 * MinerU 同时占满内存。
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_MINERU_OPTIONS,
  locateUpstream,
  spawnMineru,
  type MineruHandle,
} from "../ocr/mineru.ts";
import { normalizeIntoWorkspace } from "../ocr/jobs.ts";
import { DEFAULT_PAGE_IMAGE } from "../ocr/page-names.ts";
import { libraryIndexDir, libraryItemDir, safeSegment, workspaceRoot } from "../workspace/paths.ts";
import { writeJson } from "../workspace/json.ts";
import type { ContentListBlock } from "../knowledge/ocr-pages.ts";
import type { MiddleFile } from "../ocr/normalize.ts";
import type { OcrJobRecord } from "../ocr/types.ts";
import { markLibraryOcrActive, readLibraryItem } from "./store.ts";
import type { LibraryDocument, LibraryItem } from "./types.ts";

type QueueEntry = { itemId: string; docId: string };
const queue: QueueEntry[] = [];
const queued = new Set<string>();
let working = false;
const handles = new Map<string, MineruHandle>();

function key(itemId: string, docId: string): string {
  return `${itemId}/${docId}`;
}

function ocrDir(itemId: string, docId: string): string {
  return join(libraryIndexDir(), safeSegment(itemId), safeSegment(docId));
}

function ocrUpstream(itemId: string, docId: string): string {
  return join(libraryIndexDir(), safeSegment(itemId), ".upstream", safeSegment(docId));
}

function relativeWorkspace(path: string): string {
  return path.startsWith(workspaceRoot()) ? path.slice(workspaceRoot().length + 1) : path;
}

async function patchItem(itemId: string, docId: string, patch: (item: LibraryItem) => LibraryItem): Promise<void> {
  const item = await readLibraryItem(itemId);
  if (!item) return;
  if (!item.documents.some((entry) => entry.id === docId)) return;
  const next = patch(item);
  await writeJson(join(libraryIndexDir(), `${safeSegment(itemId)}.json`), next);
}

function stateOfDocuments(documents: LibraryDocument[]): LibraryItem["state"] {
  if (documents.some((item) => ["unindexed", "ocr_queued", "ocr_running"].includes(item.status))) return "processing";
  if (documents.some((item) => item.status === "failed")) return "failed";
  if (documents.every((item) => item.status === "needs_ocr")) return "needs_ocr";
  if (documents.some((item) => item.status === "needs_ocr")) return "partial";
  return "ready";
}

function summaryOf(documents: LibraryDocument[]): LibraryItem["summary"] {
  return {
    documents: documents.length,
    pdfs: documents.filter((item) => item.type === "pdf").length,
    markdowns: documents.filter((item) => item.type === "markdown").length,
    pages: documents.reduce((sum, item) => sum + (item.pageCount ?? 0), 0),
    searchableDocuments: documents.filter((item) => item.searchable).length,
    processingDocuments: documents.filter((item) => ["unindexed", "ocr_queued", "ocr_running"].includes(item.status)).length,
    needsOcrDocuments: documents.filter((item) => item.status === "needs_ocr").length,
  };
}

async function setDocument(itemId: string, docId: string, patch: Partial<LibraryDocument>): Promise<void> {
  await patchItem(itemId, docId, (item) => {
    const documents = item.documents.map((entry) => (entry.id === docId ? { ...entry, ...patch } : entry));
    return { ...item, documents, updatedAt: new Date().toISOString(), state: stateOfDocuments(documents), summary: summaryOf(documents) };
  });
}

async function runOne(entry: QueueEntry): Promise<void> {
  const { itemId, docId } = entry;
  markLibraryOcrActive(itemId, true);
  const item = await readLibraryItem(itemId);
  const doc = item?.documents.find((entry) => entry.id === docId);
  if (!item || !doc) {
    markLibraryOcrActive(itemId, false);
    return;
  }
  const pdf = join(libraryItemDir(itemId), doc.relativePath);
  const upstream = ocrUpstream(itemId, docId);
  const target = ocrDir(itemId, docId);
  await mkdir(upstream, { recursive: true });
  await setDocument(itemId, docId, { status: "ocr_running", progress: { pagesDone: 0, pagesTotal: doc.pageCount, stage: "识别中" } });
  try {
    const handle = spawnMineru({
      pdfPath: pdf,
      outDir: upstream,
      options: DEFAULT_MINERU_OPTIONS,
      expectedPages: doc.pageCount,
      onProgress: (progress) => {
        void setDocument(itemId, docId, {
          status: "ocr_running",
          progress: {
            pagesDone: progress.kind === "pages" ? progress.done ?? null : null,
            pagesTotal: progress.kind === "pages" ? progress.total : doc.pageCount,
            stage: progress.kind === "pages" ? `识别中 ${progress.done ?? 0}/${progress.total} 页` : `识别中 · ${progress.label} ${progress.percent}%`,
          },
        }).catch(() => undefined);
      },
    });
    handles.set(key(itemId, docId), handle);
    await handle.done;
    const located = await locateUpstream(upstream, DEFAULT_MINERU_OPTIONS.method);
    const contentList = JSON.parse(await readFile(located.contentListPath, "utf8")) as ContentListBlock[];
    const middle = JSON.parse(await readFile(located.middlePath, "utf8")) as MiddleFile;
    if (!Array.isArray(contentList)) throw new Error("上游 content_list.json 不是数组");
    const job: OcrJobRecord = {
      id: `library-${itemId}-${docId}`,
      projectId: "library",
      bookType: "knowledge",
      originalPath: pdf,
      originalName: doc.name,
      dirName: `library-${safeSegment(itemId)}-${safeSegment(docId)}`,
      status: "normalizing",
      stage: "整理识别结果",
      createdAt: item.importedAt,
      updatedAt: new Date().toISOString(),
    };
    const { manifest } = await normalizeIntoWorkspace({
      job,
      upstreamDir: located.dir,
      contentList,
      middle,
      originPdfPath: located.originPdfPath || undefined,
      imagesDir: located.imagesDir,
      method: DEFAULT_MINERU_OPTIONS.method,
      language: DEFAULT_MINERU_OPTIONS.language,
      pageImages: DEFAULT_PAGE_IMAGE,
      logTail: handle.logTail(),
      jobDir: target,
    });
    await setDocument(itemId, docId, {
      status: "indexed",
      searchable: true,
      pageCount: manifest.pageCount,
      contentPath: relativeWorkspace(join(target, "content.md")),
      pagesDir: relativeWorkspace(join(target, "pages")),
      progress: undefined,
      warnings: [`已自动 OCR（${manifest.engine.name} ${manifest.engine.version ?? ""}）`],
      error: undefined,
    });
    await rm(upstream, { recursive: true, force: true });
  } catch (error) {
    await setDocument(itemId, docId, {
      status: "failed",
      searchable: false,
      progress: undefined,
      error: (error as Error).message,
    });
    await rm(upstream, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    handles.delete(key(itemId, docId));
    markLibraryOcrActive(itemId, false);
  }
}

async function drain(): Promise<void> {
  if (working) return;
  working = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;
      queued.delete(key(next.itemId, next.docId));
      await runOne(next);
    }
  } finally {
    working = false;
  }
}

/** 入队；重复入队只保留一条。 */
export function enqueueLibraryOcr(itemId: string, docId: string): void {
  const id = key(itemId, docId);
  if (queued.has(id)) return;
  queued.add(id);
  queue.push({ itemId, docId });
  void setDocument(itemId, docId, { status: "ocr_queued", progress: { pagesDone: 0, pagesTotal: null, stage: "等待识别" } }).catch(() => undefined);
  void drain();
}

/** 取消一个条目的 OCR（移除资料时调用）。 */
export function cancelLibraryOcr(itemId: string): void {
  for (const [id, handle] of handles) {
    if (!id.startsWith(`${itemId}/`)) continue;
    try {
      handle.cancel();
    } catch {
      // 进程可能已退出
    }
    handles.delete(id);
  }
}
