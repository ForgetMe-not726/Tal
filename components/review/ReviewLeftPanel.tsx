"use client";

import * as React from "react";
import { Loader2, Play } from "lucide-react";
import { BOOK_TYPES } from "@/lib/mock";
import type { BookTypeId } from "@/lib/types";
import type { ReviewJobRecord, ReviewManifest, ReviewScope } from "@/lib/review/types";
import { cn } from "@/lib/utils";

export type ReviewProject = { id: string; name: string; grade: string; term: string };
export type ReviewLesson = { lessonNumber: number; title: string };

export type ReviewFilters = {
  bookType: string | "all";
  status: "all" | "pending" | "adopt" | "ignore" | "recheck";
  /** 只看能在正文里定位到的结论——缺证类结论（如"没有答案表"）没有定位，会淹没真问题。 */
  locatedOnly: boolean;
};

/** 教研语言的任务状态（PRODUCT.md §5）。 */
export const JOB_STATUS_LABEL: Record<ReviewJobRecord["status"], string> = {
  queued: "待审校",
  running: "审校中",
  ready: "待人工复核",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

const STATUS_TONE: Partial<Record<ReviewJobRecord["status"], string>> = {
  queued: "text-ink-3",
  running: "text-brand",
  ready: "text-spot",
  failed: "text-proof",
  cancelled: "text-ink-3",
  interrupted: "text-proof",
};

export type ReviewLeftPanelProps = {
  projects: ReviewProject[];
  projectId: string;
  onProjectChange: (id: string) => void;
  lessons: ReviewLesson[];
  lessonNumber: number | null;
  onLessonChange: (value: number) => void;
  scope: ReviewScope;
  onScopeChange: (scope: ReviewScope) => void;
  bookType: BookTypeId;
  onBookTypeChange: (bookType: BookTypeId) => void;
  moduleKey: string;
  onModuleKeyChange: (key: string) => void;
  /** 这本书下已有版本的模块（模块范围时选一个）。 */
  availableModules: Array<{ moduleKey: string; label: string; versionNumber: number }>;
  jobs: ReviewJobRecord[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  starting: boolean;
  onStart: () => void;
  canStart: boolean;
  startHint: string;
  manifest: ReviewManifest | null;
  filters: ReviewFilters;
  onFiltersChange: (filters: ReviewFilters) => void;
  ruleKeys: string[];
};

export function ReviewLeftPanel({
  projects,
  projectId,
  onProjectChange,
  lessons,
  lessonNumber,
  onLessonChange,
  scope,
  onScopeChange,
  bookType,
  onBookTypeChange,
  moduleKey,
  onModuleKeyChange,
  availableModules,
  jobs,
  selectedJobId,
  onSelectJob,
  starting,
  onStart,
  canStart,
  startHint,
  manifest,
  filters,
  onFiltersChange,
  ruleKeys,
}: ReviewLeftPanelProps) {
  const selectClass =
    "h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand";

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper">
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">教材审校</h2>
        <p className="mt-0.5 text-[10px] text-ink-3">审已保存的版本</p>
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3">
        <section className="space-y-1.5 border-b border-line pb-2.5">
          <label htmlFor="project" className="block text-xs font-medium text-ink-2">本地项目</label>
          <select id="project" value={projectId} onChange={(event) => onProjectChange(event.target.value)} className={selectClass}>
            <option value="">选择项目…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <label htmlFor="lesson" className="block text-[10px] font-medium text-ink-2">Lesson</label>
          <select
            id="lesson"
            value={lessonNumber ?? ""}
            onChange={(event) => onLessonChange(Number(event.target.value))}
            className={selectClass}
          >
            <option value="">选择 Lesson…</option>
            {lessons.map((lesson) => (
              <option key={lesson.lessonNumber} value={lesson.lessonNumber}>
                Lesson {lesson.lessonNumber} · {lesson.title || "未命名"}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-1.5 border-b border-line pb-2.5">
          <label htmlFor="scope" className="block text-xs font-medium text-ink-2">审校范围</label>
          <select
            id="scope"
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as ReviewScope)}
            className={selectClass}
          >
            <option value="module">单个模块</option>
            <option value="book">整本书</option>
          </select>

          <label htmlFor="bookType" className="block text-[10px] font-medium text-ink-2">书种</label>
          <select
            id="bookType"
            value={bookType}
            onChange={(event) => onBookTypeChange(event.target.value as BookTypeId)}
            className={selectClass}
          >
            {BOOK_TYPES.filter((book) => book.id !== "vocab").map((book) => (
              <option key={book.id} value={book.id}>{book.label}</option>
            ))}
          </select>

          {scope === "module" && (
            <>
              <label htmlFor="module" className="block text-[10px] font-medium text-ink-2">模块</label>
              <select id="module" value={moduleKey} onChange={(event) => onModuleKeyChange(event.target.value)} className={selectClass}>
                <option value="">选择模块…</option>
                {availableModules.map((module) => (
                  <option key={module.moduleKey} value={module.moduleKey}>
                    {module.label}（v{module.versionNumber}）
                  </option>
                ))}
              </select>
              {availableModules.length === 0 && (
                <p className="text-[10px] leading-relaxed text-ink-3">这本书还没有已保存的模块版本。</p>
              )}
            </>
          )}

          <button
            type="button"
            disabled={!canStart || starting}
            onClick={onStart}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
              "bg-brand hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            开始审校
          </button>
          {!canStart && <p className="text-[10px] leading-relaxed text-ink-3">{startHint}</p>}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ink-2">审校任务</span>
            <span className="text-[10px] text-ink-3">{jobs.length}</span>
          </div>
          {jobs.length === 0 && (
            <p className="rounded-md border border-dashed border-ink-3/50 px-2 py-3 text-center text-[10px] leading-relaxed text-ink-3">
              还没有审校任务
            </p>
          )}
          <div className="space-y-1.5">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => onSelectJob(job.id)}
                className={cn(
                  "w-full rounded-md border border-line bg-paper px-2.5 py-2 text-left transition-colors",
                  "hover:border-brand/40 hover:bg-brand-tint/40",
                  job.id === selectedJobId && "border-brand/30 bg-brand-tint/40",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className={cn("text-[11px] font-medium", STATUS_TONE[job.status])}>
                    {JOB_STATUS_LABEL[job.status]}
                  </span>
                  {job.status === "running" && <Loader2 className="size-3 animate-spin text-brand" />}
                </span>
                <span className="mt-0.5 block text-[10px] text-ink-3">
                  {new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </span>
                {job.message && (
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-amber-800">{job.message}</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 筛选：按书种、处理状态、有无正文定位（PRODUCT.md §4.3 要求可筛选） */}
        {manifest && (
          <section className="space-y-1.5 border-b border-line pb-2.5">
            <span className="block text-xs font-medium text-ink-2">筛选问题</span>
            <select
              value={filters.bookType}
              onChange={(event) => onFiltersChange({ ...filters, bookType: event.target.value })}
              className={selectClass}
              aria-label="按书种筛选"
            >
              <option value="all">全部书种</option>
              {[...new Set(manifest.inputs.map((input) => input.bookType))].map((book) => (
                <option key={book} value={book}>{book}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[10px] text-ink-2">
              <input
                type="checkbox"
                checked={filters.locatedOnly}
                onChange={(event) => onFiltersChange({ ...filters, locatedOnly: event.target.checked })}
                className="size-3 accent-[#0056bf]"
              />
              只看有正文定位的结论
            </label>
            <select
              value={filters.status}
              onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as ReviewFilters["status"] })}
              className={selectClass}
              aria-label="按处理状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="pending">待处理</option>
              <option value="adopt">已采用</option>
              <option value="ignore">已忽略</option>
              <option value="recheck">待复查</option>
            </select>
            {ruleKeys.length > 0 && (
              <p className="text-[10px] leading-relaxed text-ink-3">
                本次涉及规则：{ruleKeys.join("、")}
              </p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
