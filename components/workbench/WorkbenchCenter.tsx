"use client";

import * as React from "react";
import { Download, FileText, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CropMarks,
  PlateSwatch,
  RegistrationMark,
} from "@/components/print-marks";
import { MarkdownContent } from "@/components/workbench/MarkdownContent";
import { plateLetter, plateTone } from "@/lib/mock";
import { cn } from "@/lib/utils";
import type { GeneratedBlock, ModuleDef, PlateTone } from "@/lib/types";

interface Props {
  fileName: string;
  blocks: GeneratedBlock[];
  loadingModule: string | null;
  modules: ModuleDef[];
  onRename: (name: string) => void;
  onSave: () => void;
  onExport: () => void;
}

export function WorkbenchCenter({
  fileName,
  blocks,
  loadingModule,
  modules,
  onRename,
  onSave,
  onExport,
}: Props) {
  const loadingLabel = modules.find((m) => m.id === loadingModule)?.label ?? "";
  const loadingIndex = modules.findIndex((m) => m.id === loadingModule);
  const loadingTone: PlateTone = loadingIndex >= 0 ? plateTone(loadingIndex) : "brand";

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* 工具栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-paper px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-4 shrink-0 text-ink-3" />
          <EditableFileName value={fileName} onCommit={onRename} />
          {blocks.length > 0 && (
            <Badge variant="reg" className="hidden shrink-0 sm:inline-flex">
              <RegistrationMark className="size-3" />
              已套准
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3.5" />
            导出
          </Button>
          <Button size="sm" onClick={onSave}>
            <Save className="size-3.5" />
            保存
          </Button>
        </div>
      </div>

      {/* 拼版台 */}
      <div className="flex-1 overflow-auto bg-canvas p-6 sm:p-10">
        <div className="relative mx-auto w-full max-w-[680px]">
          {/* 色标条 + 套准十字：纸边外侧 */}
          <div className="absolute -top-5 right-0 flex items-center gap-1">
            {modules.map((m, i) => (
              <PlateSwatch
                key={m.id}
                letter={plateLetter(i)}
                filled={blocks.some((b) => b.moduleLabel === m.label)}
                tone={plateTone(i)}
              />
            ))}
          </div>
          <RegistrationMark
            className={cn(
              "absolute -top-5 left-0 size-4 transition-colors",
              blocks.length > 0 ? "text-reg" : "text-ink-3",
            )}
          />

          {/* A4 拼版纸 */}
          <div className="relative rounded-[2px] bg-sheet shadow-paper">
            <CropMarks />
            <div className="px-10 py-12 sm:px-14">
              {blocks.length === 0 && !loadingModule ? (
                <EmptyState />
              ) : (
                <div className="space-y-10">
                  {blocks.map((block) => (
                    <Block key={block.id} block={block} />
                  ))}
                  {loadingModule && (
                    <LoadingBlock label={loadingLabel} tone={loadingTone} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EditableFileName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const v = draft.trim();
    if (v) onCommit(v);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
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
        <p className="mt-3 text-sm font-medium text-ink-2">拼版纸为空</p>
        <p className="mt-1 text-xs text-ink-3">请从右侧选择模块并点击生成</p>
      </div>
    </div>
  );
}

function Block({ block }: { block: GeneratedBlock }) {
  return (
    <section className="animate-ink-settle">
      <header className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <PlateSwatch letter={block.letter} filled tone={block.tone} />
        <span className="font-mono text-xs font-medium text-ink-2">
          {block.moduleLabel}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-3">
          第 {block.seq} 版
        </span>
      </header>
      <MarkdownContent content={block.markdown} />
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
        <span
          className={cn(
            "size-5 animate-pulse rounded-[3px]",
            LOADING_TONE_BG[tone],
          )}
        />
        <span className="h-3.5 w-32 animate-pulse rounded bg-line" />
      </header>
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-line" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-line" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-line" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="shrink-0 text-xs text-ink-3">出片中 · {label}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full animate-plate-fill rounded-full bg-brand" />
        </div>
      </div>
    </section>
  );
}
