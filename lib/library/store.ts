/**
 * 本地资料库：老师导入的 PDF / Markdown。
 *
 * 原件只复制到 `document/library/<item>/files/`，索引、页图和 OCR 产物放在
 * `.app/retrieval/`（可重建）。软件读取原件，不在数据库里维护第二份事实。
 */

import { copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  libraryDir,
  libraryIndexDir,
  libraryIndexFile,
  libraryItemDir,
  libraryPagesDir,
  libraryRecycleDir,
  safeSegment,
  workspaceRoot,
} from "../workspace/paths.ts";
import { readBinary } from "../workspace/files.ts";
import { listDir, readJson, writeJson } from "../workspace/json.ts";
import { extractPdfText, renderPdfPage, type PdfTextResult } from "./pdf.ts";
import { LibraryError, type LibraryDocument, type LibraryItem } from "./types.ts";

export type { LibraryDocument, LibraryItem } from "./types.ts";
export { LibraryError } from "./types.ts";

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_ITEM_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ITEM_FILES = 5000;
const ALLOWED = new Set([".pdf", ".md", ".markdown"]);
const activeIndexing = new Set<string>();
const activeOcr = new Set<string>();

function isAllowed(path: string): boolean {
  return ALLOWED.has(extname(path).toLocaleLowerCase());
}

function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!isAbsolute(rel) && !rel.startsWith("..") && !rel.startsWith(sep));
}

function itemId(title: string): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `${stamp}-${safeSegment(title).slice(0, 48) || "library"}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureItemId(title: string): Promise<string> {
  let id = itemId(title);
  let index = 2;
  while (await exists(libraryItemDir(id))) id = `${itemId(title)}-${index++}`;
  return id;
}

/** 递归列出 PDF/Markdown；不跟随符号链接，跳过临时目录。 */
async function collectFiles(root: string): Promise<Array<{ relativePath: string; bytes: number }>> {
  const out: Array<{ relativePath: string; bytes: number }> = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const absolute = join(dir, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!info.isFile() || !isAllowed(absolute)) continue;
      out.push({ relativePath: relative(root, absolute), bytes: info.size });
    }
  }
  await walk(root);
  return out;
}

function titleOf(file: string): string {
  return basename(file).replace(/\.(?:pdf|md|markdown)$/iu, "");
}

function docId(relativePath: string): string {
  return createHash("sha1").update(relativePath).digest("hex").slice(0, 10);
}

function summary(documents: LibraryDocument[]): LibraryItem["summary"] {
  return {
    documents: documents.length,
    pdfs: documents.filter((item) => item.type === "pdf").length,
    markdowns: documents.filter((item) => item.type === "markdown").length,
    pages: documents.reduce((sum, item) => sum + (item.pageCount ?? 0), 0),
    searchableDocuments: documents.filter((item) => item.searchable).length,
    processingDocuments: documents.filter((item) =>
      ["unindexed", "ocr_queued", "ocr_running"].includes(item.status),
    ).length,
    needsOcrDocuments: documents.filter((item) => item.status === "needs_ocr").length,
  };
}

function stateOf(documents: LibraryDocument[]): LibraryItem["state"] {
  if (documents.some((item) => ["unindexed", "ocr_queued", "ocr_running"].includes(item.status))) return "processing";
  if (documents.some((item) => item.status === "failed")) return "failed";
  if (documents.every((item) => item.status === "needs_ocr")) return "needs_ocr";
  if (documents.some((item) => item.status === "needs_ocr")) return "partial";
  return "ready";
}

export async function readLibraryItem(id: string): Promise<LibraryItem | null> {
  try {
    return await readJson<LibraryItem | null>(libraryIndexFile(id), null);
  } catch {
    return null;
  }
}

/** 扫描资料库；没有索引的目录也列出来，显示为“未建立索引”，不丢老师手放进去的文件。 */
export async function listLibraryItems(): Promise<LibraryItem[]> {
  await mkdir(libraryDir(), { recursive: true });
  const items: LibraryItem[] = [];
  for (const id of (await listDir(libraryDir())).sort()) {
    if (id.startsWith(".") || id.startsWith("_")) continue;
    const dir = libraryItemDir(id);
    if (!(await exists(dir))) continue;
    const indexed = await readLibraryItem(id);
    if (indexed) {
      items.push(indexed);
      continue;
    }
    const files = await collectFiles(dir);
    if (files.length === 0) continue;
    const now = new Date().toISOString();
    const documents = files.map((file) => {
      const relativePath = file.relativePath.startsWith(`files${sep}`) ? file.relativePath : join("files", file.relativePath);
      const type: LibraryDocument["type"] = extname(file.relativePath).toLocaleLowerCase() === ".pdf" ? "pdf" : "markdown";
      return {
        id: docId(relativePath),
        name: basename(file.relativePath),
        relativePath,
        type,
        bytes: file.bytes,
        pageCount: null,
        status: "unindexed" as const,
        searchable: false,
        warnings: [],
      };
    });
    items.push({
      schemaVersion: 1,
      id,
      title: id.replace(/^\d+-/u, "").replace(/-/gu, " "),
      kind: files.length > 1 || files[0]?.relativePath.includes(sep) ? "folder" : "files",
      importedAt: now,
      updatedAt: now,
      state: "processing",
      documents,
      summary: summary(documents),
    });
  }
  return items.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

async function copySelected(source: string, target: string): Promise<number> {
  const info = await stat(source);
  if (!info.isFile()) throw new LibraryError(`不是文件：${source}`);
  if (!isAllowed(source)) throw new LibraryError(`只支持 PDF 与 Markdown：${basename(source)}`);
  if (info.size > MAX_FILE_BYTES) throw new LibraryError(`${basename(source)} 超过 512 MB`);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return info.size;
}

async function prepareItem(): Promise<string> {
  const incoming = join(libraryDir(), `.incoming-${randomUUID()}`);
  await mkdir(incoming, { recursive: true });
  return incoming;
}

async function commitItem(incoming: string, id: string): Promise<void> {
  const target = libraryItemDir(id);
  if (await exists(target)) throw new LibraryError(`资料库条目已存在：${id}`);
  await rename(incoming, target);
}

function itemBase(id: string, title: string, kind: "files" | "folder", documents: LibraryDocument[], skipped = 0): LibraryItem {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    title,
    kind,
    importedAt: now,
    updatedAt: now,
    state: "processing",
    documents,
    summary: summary(documents),
    ...(skipped ? { skippedFiles: skipped } : {}),
  };
}

/** 导入一个或多个 PDF/Markdown 文件（每个文件一个条目）。 */
export async function importLibraryFiles(paths: readonly string[]): Promise<LibraryItem[]> {
  if (paths.length === 0) throw new LibraryError("没有选择文件");
  const items: LibraryItem[] = [];
  for (const source of paths) {
    const absolute = resolve(source);
    if (within(resolve(workspaceRoot()), absolute)) throw new LibraryError("不能把工作区导入资料库");
    const title = titleOf(absolute);
    const id = await ensureItemId(title);
    const incoming = await prepareItem();
    try {
      const relativePath = join("files", basename(absolute));
      const bytes = await copySelected(absolute, join(incoming, relativePath));
      const type = extname(absolute).toLocaleLowerCase() === ".pdf" ? "pdf" : "markdown";
      const doc: LibraryDocument = {
        id: docId(relativePath),
        name: basename(absolute),
        relativePath,
        type,
        bytes,
        pageCount: null,
        status: "unindexed",
        searchable: false,
        warnings: [],
      };
      const item = itemBase(id, title, "files", [doc]);
      await writeJson(join(incoming, ".item.json"), item);
      await commitItem(incoming, id);
      await writeJson(libraryIndexFile(id), item);
      items.push(item);
    } finally {
      await rm(incoming, { recursive: true, force: true });
    }
  }
  return items;
}

/** 导入一个文件夹（保留相对目录；只复制 PDF/Markdown）。 */
export async function importLibraryFolder(source: string): Promise<LibraryItem> {
  const absolute = resolve(source);
  if (within(resolve(workspaceRoot()), absolute)) throw new LibraryError("不能把工作区导入资料库");
  const info = await stat(absolute).catch(() => null);
  if (!info?.isDirectory()) throw new LibraryError("请选择一个文件夹");
  const files = await collectFiles(absolute);
  if (files.length === 0) throw new LibraryError("文件夹里没有 PDF 或 Markdown");
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (files.length > MAX_ITEM_FILES) throw new LibraryError(`文件数超过 ${MAX_ITEM_FILES}`);
  if (total > MAX_ITEM_BYTES) throw new LibraryError("资料总量超过 2 GB");

  const title = basename(absolute);
  const id = await ensureItemId(title);
  const incoming = await prepareItem();
  try {
    const documents: LibraryDocument[] = [];
    for (const file of files) {
      const relativePath = join("files", file.relativePath);
      const bytes = await copySelected(join(absolute, file.relativePath), join(incoming, relativePath));
      documents.push({
        id: docId(relativePath),
        name: basename(file.relativePath),
        relativePath,
        type: extname(file.relativePath).toLocaleLowerCase() === ".pdf" ? "pdf" : "markdown",
        bytes,
        pageCount: null,
        status: "unindexed",
        searchable: false,
        warnings: [],
      });
    }
    const item = itemBase(id, title, "folder", documents, Math.max(0, (await readdir(absolute)).length - files.length));
    await writeJson(join(incoming, ".item.json"), item);
    await commitItem(incoming, id);
    await writeJson(libraryIndexFile(id), item);
    return item;
  } finally {
    await rm(incoming, { recursive: true, force: true });
  }
}

/** 抽取 PDF 文字；测试可注入。 */
export type LibraryIndexDeps = {
  extractPdf?: (path: string) => Promise<PdfTextResult>;
};

function markdownPages(text: string): number {
  const markers = [...text.matchAll(/<!--\s*page\s+(\d+)\s*-->/giu)].map((match) => Number(match[1]));
  return markers.length ? Math.max(...markers) + 1 : 1;
}

/** 生成某一条目的索引；不启动 OCR，OCR 由调用方入队。 */
export async function indexLibraryItem(id: string, deps: LibraryIndexDeps = {}): Promise<LibraryItem> {
  const item = await readLibraryItem(id);
  if (!item) throw new LibraryError("资料条目不存在");
  const extract = deps.extractPdf ?? extractPdfText;
  const documents: LibraryDocument[] = [];
  for (const doc of item.documents) {
    const absolute = join(libraryItemDir(id), doc.relativePath);
    if (!(await exists(absolute))) {
      documents.push({ ...doc, status: "failed", searchable: false, error: "原文件不存在", warnings: [...doc.warnings] });
      continue;
    }
    if (doc.type === "markdown") {
      const text = (await readFile(absolute, "utf8")).slice(0, 2_000_000);
      const pages = markdownPages(text);
      documents.push({
        ...doc,
        pageCount: pages,
        status: "indexed",
        searchable: text.trim().length > 0,
        warnings: text.trim() ? [] : ["Markdown 是空文件"],
      });
      continue;
    }
    try {
      const result = await extract(absolute);
      const searchablePages = result.pages.filter((page) => page.chars >= 20).length;
      const ratio = result.pageCount ? searchablePages / result.pageCount : 0;
      if (ratio < 0.5) {
        documents.push({
          ...doc,
          pageCount: result.pageCount,
          status: "needs_ocr",
          searchable: false,
          warnings: [`${result.pageCount} 页中只有 ${searchablePages} 页有可提取文字，需要本机 OCR。`],
        });
        continue;
      }
      const cacheDir = join(libraryIndexDir(), safeSegment(id), doc.id);
      await mkdir(cacheDir, { recursive: true });
      const content = result.pages
        .map((page) => `<!-- page ${page.index} -->\n${page.text.trim()}`)
        .join("\n\n");
      const contentPath = relative(workspaceRoot(), join(cacheDir, "content.md"));
      await writeJson(join(cacheDir, "pages.json"), result.pages);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(cacheDir, "content.md"), `${content}\n`, "utf8");
      documents.push({
        ...doc,
        pageCount: result.pageCount,
        status: "indexed",
        searchable: true,
        contentPath,
        ...(searchablePages < result.pageCount
          ? { warnings: [`${result.pageCount} 页中 ${result.pageCount - searchablePages} 页没有可提取文字。`] }
          : {}),
      });
    } catch (error) {
      documents.push({
        ...doc,
        status: "failed",
        searchable: false,
        error: (error as Error).message,
        warnings: [...doc.warnings],
      });
    }
  }
  const next: LibraryItem = {
    ...item,
    updatedAt: new Date().toISOString(),
    state: stateOf(documents),
    documents,
    summary: summary(documents),
  };
  await writeJson(libraryIndexFile(id), next);
  return next;
}

/** 导入后异步建立索引；失败写入条目状态，不抛到 HTTP 路由。 */
export function startLibraryIndexing(id: string): void {
  if (activeIndexing.has(id)) return;
  activeIndexing.add(id);
  void indexLibraryItem(id)
    .then(async (item) => {
      // 扫描件自动进入本机 OCR 队列（由 API/管理器提供实现，见 library/ocr.ts）。
      const needs = item.documents.filter((doc) => doc.status === "needs_ocr");
      if (needs.length > 0) {
        const { enqueueLibraryOcr } = await import("./ocr.ts");
        for (const doc of needs) enqueueLibraryOcr(id, doc.id);
      }
    })
    .catch(async (error) => {
      const item = await readLibraryItem(id);
      if (item) {
        await writeJson(libraryIndexFile(id), {
          ...item,
          state: "failed",
          updatedAt: new Date().toISOString(),
          documents: item.documents.map((doc) => ({
            ...doc,
            status: "failed",
            searchable: false,
            error: (error as Error).message,
          })),
        });
      }
    })
    .finally(() => activeIndexing.delete(id));
}

/** 重启后没有进程在跑的“处理中”条目标为失败，允许老师重试。 */
export async function reconcileLibraryIndexes(): Promise<void> {
  for (const id of await listDir(libraryDir())) {
    if (id.startsWith(".")) continue;
    const item = await readLibraryItem(id);
    if (!item || activeIndexing.has(id) || activeOcr.has(id)) continue;
    if (!["processing", "needs_ocr"].includes(item.state) && !item.documents.some((doc) => ["ocr_running", "ocr_queued"].includes(doc.status))) continue;
    const documents = item.documents.map((doc) =>
      ["unindexed", "ocr_queued", "ocr_running"].includes(doc.status)
        ? { ...doc, status: "failed" as const, searchable: false, error: "应用重启导致处理中断，请重试" }
        : doc,
    );
    await writeJson(libraryIndexFile(id), { ...item, state: stateOf(documents), documents, summary: summary(documents), updatedAt: new Date().toISOString() });
  }
}

export function markLibraryOcrActive(id: string, active: boolean): void {
  if (active) activeOcr.add(id);
  else activeOcr.delete(id);
}

export async function removeLibraryItem(id: string): Promise<{ recyclePath: string }> {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) throw new LibraryError("条目标识无效");
  if (activeIndexing.has(id) || activeOcr.has(id)) {
    const { cancelLibraryOcr } = await import("./ocr.ts");
    cancelLibraryOcr(id);
    throw new LibraryError("资料仍在处理中，已停止识别，请稍后再移除");
  }
  const source = libraryItemDir(id);
  if (!within(libraryDir(), source) || dirname(source) !== resolve(libraryDir())) throw new LibraryError("条目不在资料库范围内");
  if (!(await exists(source))) throw new LibraryError("资料条目不存在");
  await mkdir(libraryRecycleDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
  let target = join(libraryRecycleDir(), `${stamp}-${safeSegment(id)}`);
  let suffix = 2;
  while (await exists(target)) target = join(libraryRecycleDir(), `${stamp}-${safeSegment(id)}-${suffix++}`);
  try {
    await rename(source, target);
  } catch {
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    await rm(source, { recursive: true, force: true });
  }
  await rm(libraryIndexFile(id), { force: true });
  await rm(join(libraryIndexDir(), safeSegment(id)), { recursive: true, force: true });
  return { recyclePath: target };
}

/** 读取资料库页图；优先使用 OCR/已有缓存，没有时按需渲染一页。 */
export async function readLibraryPage(id: string, file: string, page: number): Promise<Buffer | null> {
  const item = await readLibraryItem(id);
  if (!item) return null;
  const doc = item.documents.find((entry) => entry.relativePath === file);
  if (!doc || doc.type !== "pdf" || !Number.isInteger(page) || page < 0) return null;
  if (doc.pageCount != null && page >= doc.pageCount) return null;
  const pagesDir = doc.pagesDir ? join(workspaceRoot(), doc.pagesDir) : libraryPagesDir(id, doc.id);
  const cached = join(pagesDir, `p${String(page).padStart(4, "0")}.jpg`);
  const existing = await readBinary(cached);
  if (existing) return existing;
  await mkdir(dirname(cached), { recursive: true });
  await renderPdfPage(join(libraryItemDir(id), doc.relativePath), page, cached);
  return readBinary(cached);
}

export async function retryLibraryItem(id: string): Promise<LibraryItem> {
  const item = await readLibraryItem(id);
  if (!item) throw new LibraryError("资料条目不存在");
  const next = await indexLibraryItem(id);
  const needs = next.documents.filter((doc) => doc.status === "needs_ocr");
  if (needs.length > 0) {
    const { enqueueLibraryOcr } = await import("./ocr.ts");
    for (const doc of needs) enqueueLibraryOcr(id, doc.id);
  } else {
    startLibraryIndexing(id);
  }
  return next;
}
