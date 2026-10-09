"use client";

import * as React from "react";
import { Check, Loader2, MessageSquarePlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ContentSuggestion, GeneratedBlock } from "@/lib/types";

interface Props {
  block: GeneratedBlock | null;
  suggestions: ContentSuggestion[];
  busy: boolean;
  onGenerate: (instruction: string) => void;
  onApply: (suggestion: ContentSuggestion) => void;
  onDismiss: (id: string) => void;
}

const SEVERITY_LABEL = {
  info: "提示",
  warning: "注意",
  error: "问题",
} as const;

export function WorkbenchSuggestionPanel({
  block,
  suggestions,
  busy,
  onGenerate,
  onApply,
  onDismiss,
}: Props) {
  const [instruction, setInstruction] = React.useState("");

  function submit() {
    const value = instruction.trim();
    if (!value || !block || busy) return;
    onGenerate(value);
  }

  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-paper">
      <div className="border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <MessageSquarePlus className="size-4 text-brand" />
          修改及替换建议
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
          建议只进入右栏，不会自动覆盖正文；采用后仍需保存新版本。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!block ? (
          <div className="rounded-md border border-dashed border-ink-3/50 px-3 py-8 text-center text-xs text-ink-3">
            先在中间正文区选择一个模块
          </div>
        ) : (
          <>
            <div className="rounded-md border border-line bg-canvas px-3 py-2">
              <p className="text-[11px] font-medium text-ink-2">当前模块</p>
              <p className="mt-1 truncate font-mono text-xs text-ink">{block.moduleLabel}</p>
            </div>
            <div className="mt-3 space-y-1.5">
              <label htmlFor="suggestionInstruction" className="text-xs font-medium text-ink-2">
                想怎么改？
              </label>
              <Textarea
                id="suggestionInstruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="例如：减少重复例句，保留核心词并改成更适合 L5 的表达"
                className="min-h-[100px] text-xs leading-relaxed"
              />
              <Button className="w-full" size="sm" onClick={submit} disabled={busy || !instruction.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquarePlus className="size-3.5" />}
                生成建议
              </Button>
            </div>

            <div className="mt-5 space-y-3">
              {suggestions.length === 0 ? (
                <p className="text-center text-[11px] leading-relaxed text-ink-3">
                  建议会显示在这里。涉及正式规则的判断会等规则录入后再执行。
                </p>
              ) : (
                suggestions.map((suggestion) => (
                  <article key={suggestion.id} className="rounded-md border border-line bg-sheet p-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={suggestion.severity === "error" ? "spot" : "outline"}>
                        {SEVERITY_LABEL[suggestion.severity]}
                      </Badge>
                      <span className="font-mono text-[10px] text-ink-3">{suggestion.kind}</span>
                      {suggestion.confidence !== null && (
                        <span className="ml-auto text-[10px] text-ink-3">
                          {Math.round(suggestion.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {suggestion.originalText && (
                      <div className="mt-2 rounded border border-proof/20 bg-proof/5 px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
                        <p className="mb-1 font-medium text-proof">原文</p>
                        {suggestion.originalText}
                      </div>
                    )}
                    {suggestion.replacementText && (
                      <div className="mt-2 rounded border border-reg/20 bg-reg/5 px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">
                        <p className="mb-1 font-medium text-reg">建议</p>
                        {suggestion.replacementText}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-2">{suggestion.reason}</p>
                    <div className="mt-3 flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => onDismiss(suggestion.id)}>
                        <X className="size-3.5" />
                        忽略
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => onApply(suggestion)}
                        disabled={
                          suggestion.kind === "note" ||
                          !suggestion.originalText ||
                          (suggestion.kind !== "delete" && !suggestion.replacementText)
                        }
                      >
                        <Check className="size-3.5" />
                        采用
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
