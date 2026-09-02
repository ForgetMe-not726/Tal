"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { PlateSwatch } from "@/components/print-marks";
import { BOOK_TYPES, MODULES, plateLetter, plateTone } from "@/lib/mock";
import { cn } from "@/lib/utils";
import type { BookTypeId, GeneratedBlock, ModuleDef } from "@/lib/types";

interface Props {
  bookType: BookTypeId;
  blocks: GeneratedBlock[];
  loadingModule: string | null;
  onGenerate: (module: ModuleDef) => void;
}

export function WorkbenchRightPanel({
  bookType,
  blocks,
  loadingModule,
  onGenerate,
}: Props) {
  const modules = MODULES[bookType];
  const bookLabel = BOOK_TYPES.find((b) => b.id === bookType)?.label;
  const loading = loadingModule !== null;
  const generated = new Set(blocks.map((b) => b.moduleLabel));

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-line bg-paper">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">
          [{bookLabel}] 模块列表
        </h2>
        <p className="mt-0.5 text-[11px] text-ink-3">
          点击模块 · 生成内容追加至正文区
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          {modules.map((m, i) => {
            const isThisLoading = loadingModule === m.id;
            const isGenerated = generated.has(m.label);
            return (
              <button
                key={m.id}
                type="button"
                disabled={loading}
                onClick={() => onGenerate(m)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-lg border border-line bg-paper px-3 py-3 text-left shadow-sm transition-all",
                  "hover:border-brand/40 hover:bg-brand-tint/40 hover:shadow",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  isGenerated && "border-brand/20 bg-brand-tint/30",
                )}
              >
                <PlateSwatch
                  letter={plateLetter(i)}
                  filled={isGenerated}
                  tone={plateTone(i)}
                />
                <span className="flex-1 text-sm font-medium text-ink">
                  {m.label}
                </span>
                {isThisLoading ? (
                  <Loader2 className="size-4 animate-spin text-brand" />
                ) : isGenerated ? (
                  <Check className="size-4 text-reg" />
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-brand-deep">
                    <Plus className="size-3.5" />
                    生成
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[11px] leading-relaxed text-ink-3">
          生成内容按顺序追加到中间拼版纸，纸边色标条同步记录已铺色版。
        </p>
      </div>
    </aside>
  );
}
