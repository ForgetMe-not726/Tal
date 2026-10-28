"use client";

import { Check, FileText, Loader2, RefreshCw, Upload } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlateSwatch } from "@/components/print-marks";
import { sourceUnitForTargetLesson } from "@/lib/knowledge/legacy-markdown";
import { plateLetter, plateTone } from "@/lib/mock";
import { BOOK_TYPES, LEVELS } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { unsupportedLessonMessage } from "@/lib/curriculum";
import type { AiDiagnosticsView, BookTypeId, GeneratedBlock, LessonType, Level, ModuleDef, OutlineLessonProfile, OutlineProfile, Term } from "@/lib/types";
import { TERM_LABEL, TERMS } from "@/lib/types";

const LESSON_TYPES: Array<{ id: LessonType; label: string }> = [
  { id: "regular", label: "常规课" },
  { id: "revision", label: "复习课" },
];

/** 默认按课时编号一一对应；大纲标注了变更则显示覆盖后的讲次。 */
function sourceUnitLabel(lesson: OutlineLessonProfile): string {
  const annotated = lesson.mappings.filter((mapping) => mapping.legacySourceUnit);
  const unit = sourceUnitForTargetLesson(lesson);
  if (!unit) return "未确定";
  return annotated.length > 0 ? `旧第 ${unit} 讲（大纲标注）` : `旧第 ${unit} 讲`;
}

interface Props {
  level: Level;
  term: Term;
  onTermChange: (term: Term) => void;
  lessonNumber: number;
  lessonTitle: string;
  bookType: BookTypeId;
  lessonType: LessonType;
  aiDiagnostics: AiDiagnosticsView | null;
  outlineProfile: OutlineProfile | null;
  selectedOutlineLesson: OutlineLessonProfile | null;
  selectedLessonKey: string | null;
  outlineFileName: string | null;
  outlineLoading: boolean;
  modules: ModuleDef[];
  blocks: GeneratedBlock[];
  loadingModule: string | null;
  /** 模块 id → 生成失败原因，就地显示，避免只有一闪而过的提示。 */
  failures?: Record<string, string>;
  /** 本地项目（此前项目名写死在页面常量里，两边对不上就选不到刚识别完的来源）。 */
  /** 已确认的 OCR 来源（资料识别页确认过的），可直接选用。 */
  ocrSources: Array<{ jobId: string; originalName: string; pageCount: number }>;
  onRefreshSources: () => void;
  onSelectOcrSource: (jobId: string) => void;
  onOutlineFileChange: (file: File) => void;
  onOutlineLessonChange: (lessonKey: string) => void;
  onLegacyMarkdownFileChange: (file: File) => void;
  onLevelChange: (value: Level) => void;
  onLessonNumberChange: (value: number) => void;
  onLessonTitleChange: (value: string) => void;
  onBookTypeChange: (value: BookTypeId) => void;
  onLessonTypeChange: (value: LessonType) => void;
  onGenerateModule: (module: ModuleDef) => void;
}

export function WorkbenchLeftPanel({
  level,
  term,
  onTermChange,
  lessonNumber,
  lessonTitle,
  bookType,
  lessonType,
  aiDiagnostics,
  outlineProfile,
  selectedOutlineLesson,
  selectedLessonKey,
  outlineFileName,
  outlineLoading,
  modules,
  blocks,
  loadingModule,
  failures = {},
  ocrSources,
  onSelectOcrSource,
  onRefreshSources,
  onOutlineFileChange,
  onOutlineLessonChange,
  onLegacyMarkdownFileChange,
  onLevelChange,
  onLessonNumberChange,
  onLessonTitleChange,
  onBookTypeChange,
  onLessonTypeChange,
  onGenerateModule,
}: Props) {
  const generated = new Set(blocks.map((block) => block.moduleKey ?? block.id));
  const doneCount = modules.filter((module) => generated.has(module.moduleKey ?? module.id)).length;
  const busy = loadingModule !== null;
  const canGenerate = selectedOutlineLesson !== null && modules.length > 0;
  const unsupported = unsupportedLessonMessage(bookType, lessonType);

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper">
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">课时设置</h2>
        {/* 只在 AI 不可用时提示；已配置是常态，不占一行 */}
        {aiDiagnostics && (aiDiagnostics.provider === "mock" || !aiDiagnostics.configured) && (
          <p className="mt-0.5 truncate text-[10px] text-amber-700">
            {aiDiagnostics.provider === "mock" ? "AI：Mock 联调" : "AI：未配置"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3">
        <section className="space-y-1.5 border-b border-line pb-2.5">
          <label htmlFor="outlineFile" className="block text-xs font-medium text-ink-2">部门大纲</label>
          <label
            htmlFor="outlineFile"
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line bg-paper px-2 py-2 text-[11px] text-ink-2 transition-colors",
              "hover:border-brand/50 hover:text-brand-deep",
              outlineLoading && "pointer-events-none opacity-60",
            )}
            title={outlineFileName ?? "选择 .xlsx 部门大纲"}
          >
            {outlineLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            <span className="max-w-[190px] truncate">
              {outlineLoading ? "正在读取…" : (outlineFileName ?? "选择大纲文件")}
            </span>
            <input
              id="outlineFile"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={outlineLoading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onOutlineFileChange(file);
                event.currentTarget.value = "";
              }}
              className="sr-only"
            />
          </label>

          {outlineProfile && (
            <>
              <label htmlFor="outlineLesson" className="block text-[10px] font-medium text-ink-2">选择目标 Lesson</label>
              <select
                id="outlineLesson"
                value={selectedLessonKey ?? ""}
                onChange={(event) => onOutlineLessonChange(event.target.value)}
                className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
              >
                {outlineProfile.lessons.map((lesson) => (
                  <option key={lesson.lessonKey} value={lesson.lessonKey}>Lesson {lesson.lessonNumber} · {lesson.title || "未命名"}</option>
                ))}
              </select>

              {selectedOutlineLesson && (
                <p className="text-[10px] text-ink-2">旧版对应：{sourceUnitLabel(selectedOutlineLesson)}</p>
              )}

              <div className="border-t border-line pt-1.5">
                <label htmlFor="legacySourceFile" className="block text-[10px] font-medium text-ink-2">
                  旧版来源（OCR）
                </label>
                <div className="flex gap-1">
                  <select
                    value=""
                    disabled={ocrSources.length === 0}
                    onChange={(event) => {
                      if (event.target.value) onSelectOcrSource(event.target.value);
                      event.currentTarget.value = "";
                    }}
                    className="h-8 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 text-[10px] text-ink outline-none focus:border-brand disabled:text-ink-3"
                  >
                    <option value="">
                      {ocrSources.length > 0 ? "从资料库选择已确认来源…" : "还没有已确认来源"}
                    </option>
                    {ocrSources.map((source) => (
                      <option key={source.jobId} value={source.jobId}>
                        {source.originalName}（{source.pageCount} 页）
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={onRefreshSources}
                    aria-label="刷新资料库来源"
                    title="刷新资料库来源"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-3 transition-colors hover:border-brand/40 hover:text-brand-deep"
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1 text-[10px] text-ink-3 transition-colors hover:text-brand-deep">
                  <Upload className="size-3" />
                  上传旧版 Markdown
                  <input
                    id="legacySourceFile"
                    type="file"
                    accept=".md,.txt"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onLegacyMarkdownFileChange(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {outlineProfile.issues.length > 0 && (
                <p className="text-[10px] text-amber-700">有 {outlineProfile.issues.length} 项单元格待确认。</p>
              )}
            </>
          )}
        </section>

        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="term" className="text-xs font-medium text-ink-2">学期</label>
          <Select value={term} onValueChange={(value) => onTermChange(value as Term)}>
            <SelectTrigger id="term" className="h-8 w-full"><SelectValue placeholder="选择学期" /></SelectTrigger>
            <SelectContent>
              {TERMS.map((item) => <SelectItem key={item} value={item}>{TERM_LABEL[item]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="level" className="text-xs font-medium text-ink-2">年级</label>
          <Select value={level} onValueChange={(value) => onLevelChange(value as Level)}>
            <SelectTrigger id="level" className="h-8 w-full"><SelectValue placeholder="选择年级" /></SelectTrigger>
            <SelectContent>
              {LEVELS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="lessonNumber" className="text-xs font-medium text-ink-2">Lesson</label>
          <input
            id="lessonNumber"
            type="number"
            min={1}
            value={lessonNumber}
            onChange={(event) => onLessonNumberChange(Number(event.target.value) || 1)}
            className="h-8 rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
          />
        </div>

        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="lessonTitle" className="text-xs font-medium text-ink-2">标题</label>
          <input
            id="lessonTitle"
            value={lessonTitle}
            onChange={(event) => onLessonTitleChange(event.target.value)}
            placeholder="例如：Fond memories"
            className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-brand"
          />
        </div>

        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="bookType" className="text-xs font-medium text-ink-2">书种</label>
          <Select value={bookType} onValueChange={(value) => onBookTypeChange(value as BookTypeId)}>
            <SelectTrigger id="bookType" className="h-8 w-full"><SelectValue placeholder="选择书种" /></SelectTrigger>
            <SelectContent>
              {BOOK_TYPES.map((book) => <SelectItem key={book.id} value={book.id}>{book.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* 课型决定挂哪些模块：学生用书复习课没有 Let's explore! / Let's read! */}
        <div className="grid grid-cols-[56px_1fr] items-center gap-2">
          <label htmlFor="lessonType" className="text-xs font-medium text-ink-2">课型</label>
          <Select value={lessonType} onValueChange={(value) => onLessonTypeChange(value as LessonType)}>
            <SelectTrigger id="lessonType" className="h-8 w-full"><SelectValue placeholder="选择课型" /></SelectTrigger>
            <SelectContent>
              {LESSON_TYPES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* 该书种的模块生成：点击模块即生成该模块 */}
        <section className="space-y-1.5 border-t border-line pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-ink-2">模块生成</span>
            <span className="text-[10px] text-ink-3">{doneCount}/{modules.length || 0}</span>
          </div>
          <div className="space-y-1.5">
            {modules.map((module, index) => {
              const isThisLoading = loadingModule === module.id;
              const isGenerated = generated.has(module.moduleKey ?? module.id);
              const failure = failures[module.id];
              return (
                <div key={module.id}>
                  <button
                    type="button"
                    data-action={`generate-${module.moduleKey ?? module.id}`}
                    disabled={busy || !canGenerate}
                    onClick={() => onGenerateModule(module)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md border border-line bg-paper px-2.5 py-2 text-left transition-colors",
                      "hover:border-brand/40 hover:bg-brand-tint/40",
                      "disabled:cursor-not-allowed disabled:opacity-60",
                      isGenerated && "border-brand/20 bg-brand-tint/30",
                      failure && !isGenerated && "border-amber-300 bg-amber-50/50",
                    )}
                  >
                    <PlateSwatch letter={plateLetter(index)} filled={isGenerated} tone={plateTone(index)} />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{module.label}</span>
                    {isThisLoading ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-brand" />
                    ) : isGenerated ? (
                      <Check className="size-3.5 shrink-0 text-reg" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-ink-3" />
                    )}
                  </button>
                  {failure && !isGenerated && (
                    <p className="mt-1 pl-7 text-[10px] leading-relaxed text-amber-800">{failure}</p>
                  )}
                </div>
              );
            })}
            {modules.length === 0 && (
              <p
                className={cn(
                  "rounded-md border border-dashed px-2 py-3 text-center text-[10px] leading-relaxed",
                  unsupported ? "border-amber-300 bg-amber-50/50 text-amber-800" : "border-ink-3/50 text-ink-3",
                )}
              >
                {unsupported ?? "该书种暂无模块目录"}
              </p>
            )}
          </div>
          {!canGenerate && modules.length > 0 && (
            <p className="text-[10px] leading-relaxed text-ink-3">请先导入大纲、选择 Lesson 和旧版 OCR。</p>
          )}
        </section>
      </div>
    </aside>
  );
}
