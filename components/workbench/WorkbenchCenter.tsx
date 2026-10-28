"use client";

import * as React from "react";
import { AlertTriangle, Download, FileText, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditableDocument } from "@/components/workbench/EditableDocument";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CropMarks, PlateSwatch, RegistrationMark } from "@/components/print-marks";
import { moduleOrdinal, normalizeModuleHeading, ordinalPrefix } from "@/lib/markdown/heading-levels";
import { plateLetter, plateTone } from "@/lib/mock";
import { cn } from "@/lib/utils";
import type { ExportFormat, GeneratedBlock, ModuleDef, ModuleVersionSummary, PlateTone } from "@/lib/types";

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "markdown", label: "Markdown" },
  { id: "docx", label: "Word (.docx)" },
];

interface Props {
  fileName: string;
  lessonTitle: string;
  lessonNumber: number;
  blocks: GeneratedBlock[];
  loadingModule: string | null;
  modules: ModuleDef[];
  selectedBlockId: string | null;
  editingDisabled: boolean;
  onRename: (name: string) => void;
  onBlockChange: (id: string, markdown: string) => void;
  onSelectBlock: (id: string) => void;
  versionHistory: Record<string, ModuleVersionSummary[]>;
  onRestoreVersion: (blockId: string, version: ModuleVersionSummary) => void;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
}

export function WorkbenchCenter({
  fileName,
  lessonTitle,
  lessonNumber,
  blocks,
  loadingModule,
  modules,
  selectedBlockId,
  editingDisabled,
  onRename,
  onBlockChange,
  onSelectBlock,
  versionHistory,
  onRestoreVersion,
  onSave,
  onExport,
}: Props) {
  const loadingLabel = modules.find((m) => m.id === loadingModule)?.label ?? "";
  const loadingIndex = modules.findIndex((m) => m.id === loadingModule);
  const loadingTone: PlateTone = loadingIndex >= 0 ? plateTone(loadingIndex) : "brand";
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>("markdown");
  // 编号顺序来自模块目录（modules 已按课型过滤、按 sortOrder 排好），不在这里写死。
  const numberedKeys = modules.filter((item) => item.numbered).map((item) => item.moduleKey ?? item.id);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-paper px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-4 shrink-0 text-ink-3" />
          <EditableFileName value={fileName} onCommit={onRename} />
          {blocks.length > 0 && (
            <Badge variant="reg" className="hidden shrink-0 sm:inline-flex">
              <RegistrationMark className="size-3" />
              已有版本
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={exportFormat}
            onValueChange={(value) => setExportFormat(value as ExportFormat)}
            disabled={editingDisabled}
          >
            <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="导出格式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_FORMATS.map((format) => (
                <SelectItem key={format.id} value={format.id}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => onExport(exportFormat)} disabled={editingDisabled}>
            <Download className="size-3.5" />
            导出
          </Button>
          <Button size="sm" onClick={onSave} disabled={editingDisabled}>
            <Save className="size-3.5" />
            保存新版本
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-canvas p-6 sm:p-10">
        <div className="relative mx-auto w-full max-w-[760px]">
          <div className="absolute -top-5 right-0 flex items-center gap-1">
            {modules.map((module, index) => (
              <PlateSwatch
                key={module.id}
                letter={plateLetter(index)}
                filled={blocks.some((block) => block.moduleKey === (module.moduleKey ?? module.id))}
                tone={plateTone(index)}
              />
            ))}
          </div>
          <RegistrationMark
            className={cn(
              "absolute -top-5 left-0 size-4 transition-colors",
              blocks.length > 0 ? "text-reg" : "text-ink-3",
            )}
          />

          <div className="relative rounded-[2px] bg-sheet shadow-paper">
            <CropMarks />
            <div className="px-10 py-12 sm:px-14">
              {blocks.length === 0 && !loadingModule ? (
                <EmptyState />
              ) : (
                <>
                  <DocumentTitle lessonNumber={lessonNumber} lessonTitle={lessonTitle} />
                  <div className="space-y-10">
                    {blocks.map((block) => {
                      const definition = modules.find(
                        (item) => (item.moduleKey ?? item.id) === (block.moduleKey ?? block.id),
                      );
                      return (
                        <Block
                          key={block.id}
                          block={block}
                          ordinal={moduleOrdinal(block.moduleKey, numberedKeys)}
                          heading={definition?.heading ?? null}
                          selected={block.id === selectedBlockId}
                          onSelect={() => onSelectBlock(block.id)}
                          onChange={(markdown) => onBlockChange(block.id, markdown)}
                          versions={versionHistory[block.moduleId ?? ""] ?? []}
                          onRestore={(version) => onRestoreVersion(block.id, version)}
                          editingDisabled={editingDisabled}
                        />
                      );
                    })}
                    {loadingModule && <LoadingBlock label={loadingLabel} tone={loadingTone} />}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocumentTitle({
  lessonNumber,
  lessonTitle,
}: {
  lessonNumber: number;
  lessonTitle: string;
}) {
  return (
    <header className="mb-8 border-b-2 border-ink/15 pb-4">
      <h1 className="text-[26px] font-bold tracking-tight text-ink">
        Lesson {lessonNumber}
        {lessonTitle ? ` ${lessonTitle}` : ""}
      </h1>
    </header>
  );
}

function EditableFileName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (next) onCommit(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          else if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-7 w-56 rounded-md border border-brand bg-paper px-2 font-mono text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        aria-label="文件名"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="点击重命名"
      className="group flex min-w-0 items-center gap-1.5 font-mono text-sm text-ink transition-colors hover:text-brand-deep"
    >
      <span className="truncate">{value}</span>
      <Pencil className="size-3 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[560px] items-center justify-center">
      <div className="w-full max-w-sm rounded-md border border-dashed border-ink-3/50 px-6 py-12 text-center">
        <RegistrationMark className="mx-auto size-6 text-ink-3" />
        <p className="mt-3 text-sm font-medium text-ink-2">正文区为空</p>
        <p className="mt-1 text-xs text-ink-3">导入大纲与旧版材料后，点左侧模块开始生成</p>
      </div>
    </div>
  );
}

function Block({
  block,
  ordinal,
  heading,
  selected,
  onSelect,
  onChange,
  versions,
  onRestore,
  editingDisabled,
}: {
  block: GeneratedBlock;
  /** 模块在整课里的编号；不参与编号的模块（学习目标、主题页）为 null。 */
  ordinal: number | null;
  /** 正文标题（不含编号）；null 表示标题并进表格首行。 */
  heading: string | null;
  selected: boolean;
  onSelect: () => void;
  onChange: (markdown: string) => void;
  versions: ModuleVersionSummary[];
  onRestore: (version: ModuleVersionSummary) => void;
  editingDisabled: boolean;
}) {
  const moduleKey = block.moduleKey ?? "";
  // 表格首行用的标题文字（「学习目标」），与正文里的标题不是一回事。
  const title = block.moduleLabel;
  // 编号模块带序号；不编号但有自己的标题（学生用书主题页）保留标题、不带号；
  // heading 为 null（知识清单「学习目标」）则去掉标题行，标题并进表格首行。
  const bodyHeading = heading ? `${ordinalPrefix(ordinal)}${heading}` : null;
  const dirty = block.markdown !== block.savedMarkdown;

  return (
    <section
      className={cn(
        "group/block animate-ink-settle rounded-md px-3 py-2 transition-colors",
        selected && "bg-brand-tint/20 ring-1 ring-brand/20",
      )}
    >
      {/* 模块标题在正文里（`# 1. Let's say!`），这里只放状态和操作，避免同一标题出现两次。 */}
      <header className="mb-1 flex items-center gap-2">
        {dirty && <Badge variant="spot">未保存修改</Badge>}
        {/* select-none：整块复制正文时不要带上这里的控件文字。 */}
        <div className="ml-auto flex select-none items-center gap-2 opacity-0 transition-opacity group-hover/block:opacity-100 focus-within:opacity-100">
          {versions.length > 0 && (
            <select
              defaultValue=""
              disabled={editingDisabled}
              onChange={(event) => {
                const version = versions.find((item) => item.id === event.target.value);
                if (version) onRestore(version);
                event.currentTarget.value = "";
              }}
              className="max-w-28 rounded border border-line bg-sheet px-1 py-0.5 text-[10px] text-ink-3"
              aria-label="恢复模块版本为编辑草稿"
            >
              <option value="">历史版本</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version_number} · {version.origin_kind === "ai_generated" ? "AI" : "人工"}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {block.checks && block.checks.length > 0 && (
        <div className="mb-3 rounded-md border border-proof/25 bg-proof/5 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          <p className="flex items-center gap-1.5 font-medium text-proof">
            <AlertTriangle className="size-3.5" />
            确定性检查：{block.checks.length} 项
          </p>
          <ul className="mt-1 space-y-0.5">
            {block.checks.slice(0, 4).map((issue, issueIndex) => (
              <li key={`${issue.ruleKey}-${issue.code}-${issueIndex}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <EditableDocument
        content={normalizeModuleHeading(block.markdown, bodyHeading)}
        bookType={block.bookTypeId}
        moduleKey={moduleKey}
        moduleTitle={title}
        disabled={editingDisabled}
        onFocus={onSelect}
        onChange={onChange}
      />
    </section>
  );
}

const LOADING_TONE_BG: Record<PlateTone, string> = {
  brand: "bg-brand/40",
  spot: "bg-spot/40",
  reg: "bg-reg/40",
  violet: "bg-violet/40",
};

function LoadingBlock({ label, tone }: { label: string; tone: PlateTone }) {
  return (
    <section aria-busy="true">
      <header className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <span className={cn("size-5 animate-pulse rounded-[3px]", LOADING_TONE_BG[tone])} />
        <span className="h-3.5 w-32 animate-pulse rounded bg-line" />
      </header>
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-line" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-line" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-line" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="shrink-0 text-xs text-ink-3">生成中 · {label}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full animate-plate-fill rounded-full bg-brand" />
        </div>
      </div>
    </section>
  );
}
