"use client";

import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { BOOK_TYPES } from "@/lib/mock";
import { TERM_LABEL, TERMS } from "@/lib/types";
import type { BookTypeId, Term } from "@/lib/types";
import type { OcrJobView } from "@/lib/ocr/jobs";
import type { OcrJobStatus } from "@/lib/ocr/types";
import { cn } from "@/lib/utils";

export type RecognizeLeftPanelProps = {
  /** 学期只用于资料库文件夹命名（spring-sb-ocr），不改变解析规则。 */
  term: Term;
  onTermChange: (term: Term) => void;
  bookType: BookTypeId;
  onBookTypeChange: (bookType: BookTypeId) => void;
  jobs: OcrJobView[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  uploading: boolean;
  onUploadFile: (file: File) => void;
  onImportUpstream: (upstreamDir: string, originalPath: string) => void;
  engineReady: boolean;
  engineReason?: string;
  /** 选中任务的页缩略图与当前页。 */
  pageCount: number;
  pageIndex: number;
  onSelectPage: (index: number) => void;
  jobId: string | null;
};

/** 教研语言的状态词（PRODUCT.md §5），不显示内部枚举。 */
const STATUS_LABEL: Record<OcrJobStatus, string> = {
  queued: "待识别",
  running: "识别中",
  normalizing: "整理结果",
  ready: "待核对",
  confirmed: "已确认来源",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

const STATUS_TONE: Partial<Record<OcrJobStatus, string>> = {
  ready: "text-amber-700",
  confirmed: "text-reg",
  failed: "text-proof",
  interrupted: "text-proof",
  cancelled: "text-ink-3",
  running: "text-brand",
  normalizing: "text-brand",
  queued: "text-ink-3",
};

export function jobStatusOf(job: OcrJobView): OcrJobStatus {
  return job.manifest?.status ?? job.status;
}

export function RecognizeLeftPanel({
  term,
  onTermChange,
  bookType,
  onBookTypeChange,
  jobs,
  selectedJobId,
  onSelectJob,
  uploading,
  onUploadFile,
  onImportUpstream,
  engineReady,
  engineReason,
  pageCount,
  pageIndex,
  onSelectPage,
  jobId,
}: RecognizeLeftPanelProps) {
  const [upstreamDir, setUpstreamDir] = React.useState("");

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper">
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">资料识别</h2>
        <p className="mt-0.5 text-[10px] text-ink-3">
          {engineReady ? "本机 OCR 引擎已就绪" : (engineReason ?? "OCR 引擎不可用")}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3">
        {/* 学期 + 书种决定资料库文件夹名：spring-sb-ocr */}
        <section className="space-y-1.5 border-b border-line pb-2.5">
          <label htmlFor="term" className="block text-xs font-medium text-ink-2">
            学期
          </label>
          <select
            id="term"
            value={term}
            onChange={(event) => onTermChange(event.target.value as Term)}
            className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
          >
            {TERMS.map((item) => (
              <option key={item} value={item}>
                {TERM_LABEL[item]}
              </option>
            ))}
          </select>
          <label htmlFor="bookType" className="block text-xs font-medium text-ink-2">
            书种
          </label>
          <select
            id="bookType"
            value={bookType}
            onChange={(event) => onBookTypeChange(event.target.value as BookTypeId)}
            className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
          >
            {BOOK_TYPES.map((book) => (
              <option key={book.id} value={book.id}>
                {book.label}
              </option>
            ))}
          </select>

        </section>

        {/* 导入：原件只复制进工作区，不改写 */}
        <section className="space-y-1.5">
          <label
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-paper px-2 py-2 text-[11px] text-ink-2 transition-colors",
              "hover:border-brand/50 hover:text-brand-deep",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? "正在导入…" : "选择 PDF / 图片"}
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>

          <details className="text-[10px] text-ink-3">
            <summary className="cursor-pointer select-none">导入已处理过的 OCR 产物</summary>
            <div className="mt-1.5 space-y-1.5">
              <input
                value={upstreamDir}
                onChange={(event) => setUpstreamDir(event.target.value)}
                placeholder="上游产物目录（含 _content_list.json）"
                className="h-7 w-full rounded border border-line bg-paper px-2 text-[10px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
              />
              <button
                type="button"
                disabled={!upstreamDir.trim()}
                onClick={() => {
                  onImportUpstream(upstreamDir.trim(), "");
                  setUpstreamDir("");
                }}
                className="rounded border border-line px-2 py-1 text-[10px] text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep disabled:opacity-50"
              >
                导入目录
              </button>
            </div>
          </details>
        </section>

        {/* 任务列表 */}
        <section className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ink-2">识别任务</span>
            <span className="text-[10px] text-ink-3">{jobs.length}</span>
          </div>
          {jobs.length === 0 && (
            <p className="rounded-md border border-dashed border-ink-3/50 px-2 py-3 text-center text-[10px] leading-relaxed text-ink-3">
              还没有识别任务
            </p>
          )}
          <div className="space-y-1.5">
            {jobs.map((job) => {
              const status = jobStatusOf(job);
              const active = job.id === selectedJobId;
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => onSelectJob(job.id)}
                  className={cn(
                    "w-full rounded-md border border-line bg-paper px-2.5 py-2 text-left transition-colors",
                    "hover:border-brand/40 hover:bg-brand-tint/40",
                    active && "border-brand/30 bg-brand-tint/40",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn("text-[11px] font-medium", STATUS_TONE[status])}>
                      {STATUS_LABEL[status]}
                    </span>
                    {job.status === "running" && <Loader2 className="size-3 animate-spin text-brand" />}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-ink-2" title={job.originalName}>
                    {job.originalName}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-3">
                    {["queued", "running", "normalizing"].includes(job.status)
                      ? job.stage
                      : job.pagesTotal != null
                        ? `${job.pagesTotal} 页`
                        : job.stage}
                    {job.dirName && (
                      <>
                        {" · "}
                        <span className="font-mono">{job.dirName}</span>
                      </>
                    )}
                  </span>
                  {job.message && status !== "ready" && status !== "confirmed" && (
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-amber-800">
                      {job.message}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* 页缩略图：原页是证据，点一下跳到那一页 */}
        {jobId && pageCount > 0 && (
          <section className="space-y-1.5">
            <span className="text-xs font-medium text-ink-2">页</span>
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: pageCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => onSelectPage(index)}
                  className={cn(
                    "overflow-hidden rounded border transition-colors",
                    index === pageIndex ? "border-brand ring-1 ring-brand/30" : "border-line hover:border-brand/40",
                  )}
                  title={`第 ${index + 1} 页`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/ocr/${jobId}/raw/pages/p${String(index).padStart(4, "0")}.jpg`}
                    alt={`第 ${index + 1} 页`}
                    loading="lazy"
                    className="aspect-[3/4] w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
