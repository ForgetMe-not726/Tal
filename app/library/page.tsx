"use client";

import * as React from "react";
import Link from "next/link";
import { FolderOpen, Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOOK_TYPES } from "@/lib/mock";

type Source = {
  jobId: string;
  dirName?: string;
  bookType: string;
  originalName: string;
  pageCount: number;
  confirmedAt: string;
};

type Collection = {
  id: string;
  title: string;
  kind: "exemplar" | "cambridge" | "reference";
  grade: string;
  term: string;
  books: Array<{ bookType: string; lessons?: unknown[] }>;
};

type LibraryDocument = {
  id: string;
  name: string;
  relativePath: string;
  type: "pdf" | "markdown";
  bytes: number;
  pageCount: number | null;
  status: "indexed" | "unindexed" | "ocr_queued" | "ocr_running" | "needs_ocr" | "failed";
  searchable: boolean;
  progress?: { pagesDone: number | null; pagesTotal: number | null; stage?: string };
  warnings: string[];
  error?: string;
};

type LibraryItem = {
  id: string;
  title: string;
  kind: "files" | "folder";
  importedAt: string;
  state: "processing" | "ready" | "partial" | "needs_ocr" | "failed";
  documents: LibraryDocument[];
  summary: { documents: number; pages: number; searchableDocuments: number; processingDocuments: number; needsOcrDocuments: number };
};

type LibraryData = {
  workspace: string;
  ocrDir: string;
  knowledgeDir: string;
  libraryDir: string;
  sources: Source[];
  confirmedCount: number;
  pendingCount: number;
  collections: Collection[];
  grammarCount: number;
  standardsCount: number;
  library: { items: LibraryItem[]; processingCount: number; needsOcrCount: number };
};

const COLLECTION_KIND_LABEL: Record<Collection["kind"], string> = {
  exemplar: "范本教材",
  cambridge: "剑桥权威资料",
  reference: "参考资料",
};

function bookLabel(bookType: string): string {
  return BOOK_TYPES.find((book) => book.id === bookType)?.label ?? bookType;
}

export default function LibraryPage() {
  const [data, setData] = React.useState<LibraryData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      const payload = (await response.json()) as LibraryData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "资料库加载失败");
      setData(payload);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    // 首屏用 promise 回调写入状态：effect 体内不同步 setState
    let active = true;
    void fetch("/api/library", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as LibraryData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "资料库加载失败");
        if (!active) return;
        setData(payload);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError((caught as Error).message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function openFolder(target: "workspace" | "ocr" | "knowledge" | "library") {
    try {
      const response = await fetch("/api/library/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "打开文件夹失败");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  React.useEffect(() => {
    if (!data || data.library.processingCount === 0) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [data, load]);

  async function pickAndImport(mode: "files" | "folder") {
    if (!window.desktop?.pickLibraryFiles) {
      setError("导入需要在桌面应用中使用本机文件选择框。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const paths =
        mode === "files"
          ? await window.desktop.pickLibraryFiles()
          : await window.desktop.pickLibraryFolder();
      if (paths.length === 0) return;
      const response = await fetch("/api/library/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, paths }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "导入失败");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: LibraryItem) {
    if (!window.confirm(`把「${item.title}」移到本地回收区？原始资料会保留，可在回收区恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "移除失败");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retryItem(item: LibraryItem) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/library/items/${encodeURIComponent(item.id)}/retry`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "重新处理失败");
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function itemStatus(item: LibraryItem): { label: string; tone: string } {
    if (item.state === "ready") return { label: "可检索", tone: "text-reg border-reg/40" };
    if (item.state === "partial") return { label: "部分可检索", tone: "text-amber-700 border-amber-700/40" };
    if (item.state === "needs_ocr") return { label: "需要识别", tone: "text-spot border-spot/40" };
    if (item.state === "failed") return { label: "处理失败", tone: "text-proof border-proof/40" };
    return { label: "处理中", tone: "text-ink-2 border-line" };
  }

  function docProgress(doc: LibraryDocument): string {
    if (doc.status === "ocr_running" || doc.status === "ocr_queued") {
      const total = doc.progress?.pagesTotal;
      const done = doc.progress?.pagesDone;
      return doc.progress?.stage ?? (total ? `识别中 ${done ?? 0}/${total} 页` : "等待识别");
    }
    if (doc.status === "failed") return doc.error ?? "处理失败";
    if (doc.status === "needs_ocr") return "需要本机 OCR";
    return doc.pageCount ? `${doc.pageCount} 页` : doc.type === "markdown" ? "Markdown" : "PDF";
  }

  function formatBytes(bytes: number): string {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">本地资料库</h1>
            <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title={data?.workspace}>
              {data?.workspace ?? "正在读取工作区…"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void openFolder("workspace")}>
            <FolderOpen className="size-3.5" />
            打开工作区
          </Button>
        </header>

        {error && (
          <p className="mt-4 rounded-md border border-proof/30 bg-proof/5 px-3 py-2 text-xs text-proof">
            {error}
          </p>
        )}

        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">本地资料</h2>
              <p className="mt-0.5 text-xs text-ink-3">
                导入 PDF 或 Markdown；扫描版 PDF 会在本机后台自动识别。软件只读取这些文件，移除时移到回收区。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void pickAndImport("files")} disabled={busy}>
                <Upload className="size-3.5" />
                导入文件
              </Button>
              <Button variant="outline" size="sm" onClick={() => void pickAndImport("folder")} disabled={busy}>
                <FolderOpen className="size-3.5" />
                导入文件夹
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openFolder("library")}>
                <FolderOpen className="size-3.5" />
                打开资料库
              </Button>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
            {!data ? (
              <p className="px-4 py-8 text-center text-xs text-ink-3">正在读取资料库…</p>
            ) : data.library.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs leading-relaxed text-ink-3">
                还没有导入资料。老师手里的 PDF 和 Markdown 可以从本机选择，导入后立即可检索。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.library.items.map((item) => {
                  const status = itemStatus(item);
                  const bytes = item.documents.reduce((sum, doc) => sum + doc.bytes, 0);
                  return (
                    <li key={item.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink" title={item.title}>{item.title}</span>
                          <span className="mt-0.5 block text-[11px] text-ink-3">
                            {item.kind === "folder" ? "文件夹" : "文件"} · {item.documents.length} 份 · {formatBytes(bytes)}
                            {item.summary.pages ? ` · ${item.summary.pages} 页` : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${status.tone}`}>{status.label}</span>
                        <Button variant="ghost" size="sm" onClick={() => void retryItem(item)} disabled={busy}>
                          重新处理
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void removeItem(item)} disabled={busy}>
                          移除
                        </Button>
                      </div>
                      {item.documents.map((doc) => (
                        <p key={doc.id} className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-ink-3">
                          <span className="max-w-[55%] truncate">{doc.name}</span>
                          <span>{docProgress(doc)}</span>
                          {doc.status === "indexed" && <span>可检索</span>}
                          {doc.error && <span className="text-proof">{doc.error}</span>}
                        </p>
                      ))}
                      {item.documents.some((doc) => doc.warnings.length > 0) && (
                        <p className="mt-1 text-[10px] leading-relaxed text-amber-700">
                          {item.documents.flatMap((doc) => doc.warnings).join("；")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="truncate border-t border-line px-4 py-2 font-mono text-[10px] text-ink-3" title={data?.libraryDir}>
              {data?.libraryDir}
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">教材识别结果</h2>
              <p className="mt-0.5 text-xs text-ink-3">
                已确认 {data?.confirmedCount ?? 0} 本
                {data && data.pendingCount > 0 ? ` · 待核对 ${data.pendingCount} 本` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/recognize"
                className="inline-flex items-center gap-1 text-xs text-brand-deep hover:underline"
              >
                <Upload className="size-3.5" />
                导入新教材
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBusy(true);
                  void load();
                }}
                disabled={busy}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                刷新
              </Button>
              <Button variant="outline" size="sm" onClick={() => void openFolder("ocr")}>
                <FolderOpen className="size-3.5" />
                打开文件夹
              </Button>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
            {!data ? (
              <p className="px-4 py-8 text-center text-xs text-ink-3">正在读取资料库…</p>
            ) : data.sources.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs leading-relaxed text-ink-3">
                还没有已确认的教材。到「资料识别」导入 PDF，核对无误后确认即可。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.sources.map((source) => (
                  <li key={source.jobId} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-20 shrink-0 text-[11px] text-ink-3">{bookLabel(source.bookType)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink" title={source.originalName}>
                      {source.originalName}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {source.pageCount} 页
                      {source.dirName ? ` · ${source.dirName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
            更换教材：到「资料识别」导入 PDF，核对后确认，制作页会自动出现；识别结果按书种和学期放在固定英文文件夹里，可直接备份。
            更换参考资料：整批替换 <span className="font-mono">knowledge/collections/&lt;批次&gt;/</span> 目录并保留 manifest.json。
          </p>
        </section>

        <section className="mt-9">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight">参考知识库</h2>
              <p className="mt-0.5 text-xs text-ink-3">
                范本教材、语法参考和审校判据，随安装包分发，也可按批投入
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void openFolder("knowledge")}>
              <FolderOpen className="size-3.5" />
              打开文件夹
            </Button>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-ink-2">
              <span>范本 / 参考资料集合</span>
              <span className="text-ink-3">{data?.collections.length ?? 0} 批</span>
            </div>
            {data && data.collections.length > 0 ? (
              <ul className="divide-y divide-line">
                {data.collections.map((collection) => (
                  <li key={collection.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{collection.title || collection.id}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-3">
                        {COLLECTION_KIND_LABEL[collection.kind] ?? collection.kind} · {collection.grade} ·{" "}
                        {collection.term} · {collection.books.length} 本书
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">{collection.id}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-ink-3">
                还没有资料集合。范本教材由安装包带入，或按专题批量投入。
              </p>
            )}
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line text-xs">
              <div className="px-4 py-2.5 text-ink-2">
                语法参考 <span className="ml-1 text-ink-3">{data?.grammarCount ?? 0} 个知识点</span>
              </div>
              <div className="px-4 py-2.5 text-ink-2">
                审校判据 <span className="ml-1 text-ink-3">{data?.standardsCount ?? 0} 份</span>
              </div>
            </div>
          </div>
          <p className="mt-2 truncate font-mono text-[10px] text-ink-3" title={data?.knowledgeDir}>
            {data?.knowledgeDir}
          </p>
        </section>
      </div>
    </div>
  );
}
