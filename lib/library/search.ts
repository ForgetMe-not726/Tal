/**
 * 本地资料库 → 通用助手检索语料。
 *
 * 只读可检索的资料：Markdown 直接读原文；PDF 读资料库索引（数字版文字层或
 * 自动 OCR 后的 content.md）。扫描件没有完成 OCR 前不贡献命中，避免把“看不见的
 * 正文”说成可参考证据。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { libraryItemDir, workspaceRoot } from "../workspace/paths.ts";
import { parseContentPages } from "../assistant/text.ts";
import { listLibraryItems } from "./store.ts";
import type { LibraryDocument, LibraryItem } from "./types.ts";

export type LibraryCorpusDoc = {
  itemId: string;
  documentId: string;
  documentName: string;
  pageIndex: number | null;
  text: string;
  sourceRef: string;
  pageImageUrl?: string;
};

export type LibraryCorpusResult = {
  docs: LibraryCorpusDoc[];
  gaps: string[];
  processing: number;
  needsOcr: number;
};

const MAX_ITEMS = 200;
const MAX_PAGES = 20_000;
const MAX_CHARS = 200_000;

function pageUrl(itemId: string, document: LibraryDocument, page: number): string {
  return `/api/library/items/${encodeURIComponent(itemId)}/page?file=${encodeURIComponent(document.relativePath)}&page=${page}`;
}

function label(item: LibraryItem, document: LibraryDocument): string {
  return item.documents.length === 1 ? item.title : `${item.title} / ${document.name}`;
}

export async function collectLibraryCorpus(): Promise<LibraryCorpusResult> {
  const items = (await listLibraryItems()).slice(0, MAX_ITEMS);
  const docs: LibraryCorpusDoc[] = [];
  const gaps: string[] = [];
  let processing = 0;
  let needsOcr = 0;

  for (const item of items) {
    const searchableDocs = item.documents.filter((doc) => doc.searchable && ["indexed"].includes(doc.status));
    if (item.documents.some((doc) => ["unindexed", "ocr_queued", "ocr_running"].includes(doc.status))) processing += 1;
    if (item.documents.some((doc) => doc.status === "needs_ocr")) needsOcr += 1;

    for (const document of searchableDocs) {
      if (docs.length >= MAX_PAGES) break;
      const name = label(item, document);
      if (document.type === "markdown") {
        try {
          const text = (await readFile(join(libraryItemDir(item.id), document.relativePath), "utf8")).slice(0, MAX_CHARS);
          if (text.trim()) {
            docs.push({
              itemId: item.id,
              documentId: document.id,
              documentName: name,
              pageIndex: null,
              text,
              sourceRef: `library:${item.id}/${document.id}`,
            });
          }
        } catch (error) {
          gaps.push(`资料「${name}」读取失败：${(error as Error).message}`);
        }
        continue;
      }

      if (!document.contentPath) continue;
      try {
        const text = (await readFile(join(workspaceRoot(), document.contentPath), "utf8")).slice(0, MAX_CHARS);
        const pages = parseContentPages(text);
        for (const [pageIndex, pageText] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
          if (docs.length >= MAX_PAGES) break;
          if (!pageText.trim()) continue;
          docs.push({
            itemId: item.id,
            documentId: document.id,
            documentName: name,
            pageIndex,
            text: pageText,
            sourceRef: `library:${item.id}/${document.id}/p${pageIndex}`,
            pageImageUrl: pageUrl(item.id, document, pageIndex),
          });
        }
      } catch (error) {
        gaps.push(`资料「${name}」的索引缓存读取失败：${(error as Error).message}`);
      }
    }
  }

  if (processing > 0) gaps.push(`资料库里有 ${processing} 份资料还在建立索引/OCR，完成后才会参与检索。`);
  if (needsOcr > 0) gaps.push(`资料库里有 ${needsOcr} 份 PDF 没有可提取文字，正在或需要 OCR。`);
  return { docs, gaps, processing, needsOcr };
}
