/** 本地资料库（PDF / Markdown）的数据契约。 */

export type LibraryDocumentType = "pdf" | "markdown";
export type LibraryDocumentStatus = "indexed" | "unindexed" | "ocr_queued" | "ocr_running" | "needs_ocr" | "failed";

export type LibraryDocument = {
  id: string;
  name: string;
  relativePath: string;
  type: LibraryDocumentType;
  bytes: number;
  pageCount: number | null;
  status: LibraryDocumentStatus;
  searchable: boolean;
  /** 可检索文本缓存（Markdown 直接用原文件时为空）。 */
  contentPath?: string;
  /** 页图缓存目录（相对于工作区）。 */
  pagesDir?: string;
  progress?: { pagesDone: number | null; pagesTotal: number | null; stage?: string };
  warnings: string[];
  error?: string;
};

export type LibraryItem = {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: "files" | "folder";
  importedAt: string;
  updatedAt: string;
  state: "processing" | "ready" | "partial" | "needs_ocr" | "failed";
  documents: LibraryDocument[];
  summary: {
    documents: number;
    pdfs: number;
    markdowns: number;
    pages: number;
    searchableDocuments: number;
    processingDocuments: number;
    needsOcrDocuments: number;
  };
  /** 导入时跳过的非 PDF/Markdown 文件数。 */
  skippedFiles?: number;
};

export type LibraryPageImage = { data: Buffer; contentType: string };

export class LibraryError extends Error {}
