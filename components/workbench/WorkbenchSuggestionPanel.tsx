"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageEvidence } from "@/components/evidence/PageEvidence";
import type { ContentSuggestion, GeneratedBlock, WorkbenchSuggestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export type SuggestionRuleRef = {
  ruleKey: string;
  displayName: string;
  isHard: boolean;
  scope: string;
};

export type SuggestionGap = { kind: string; message: string };

interface Props {
  block: GeneratedBlock | null;
  suggestions: WorkbenchSuggestion[];
  /** 本次进 Context Pack 的规则（把规则 ID 显示成规则名）。 */
  rules: SuggestionRuleRef[];
  /** 本次资料缺口与规则冲突——老师要能看见"这次依据全不全"。 */
  gaps: SuggestionGap[];
  conflicts: Array<{ key: string; summary: string }>;
  busy: boolean;
  onGenerate: (instruction: string) => void;
  onApply: (suggestion: ContentSuggestion) => void;
  onDismiss: (id: string) => void;
}

const STATUS_LABEL: Record<WorkbenchSuggestion["status"], string> = {
  pending: "待处理",
  adopted: "已采用",
  ignored: "已忽略",
};

export function WorkbenchSuggestionPanel({
  block,
  suggestions,
  rules,
  gaps,
  conflicts,
  busy,
  onGenerate,
  onApply,
  onDismiss,
}: Props) {
  const [instruction, setInstruction] = React.useState("");
  const ruleByKey = React.useMemo(() => new Map(rules.map((rule) => [rule.ruleKey, rule])), [rules]);

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
          修改建议
        </h2>
        <p className="mt-1 text-[10px] text-ink-3">只改草稿，保存后生成新版本</p>
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

            {(gaps.length > 0 || conflicts.length > 0) && (
              <div className="mt-3 rounded-md border border-line bg-canvas/60 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
                  <AlertTriangle className="size-3.5 text-spot" />
                  本次依据情况
                </p>
                <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-ink-3">
                  {conflicts.map((conflict) => (
                    <li key={`conflict-${conflict.key}`}>规则冲突 · {conflict.summary}</li>
                  ))}
                  {gaps.map((gap) => (
                    <li key={`${gap.kind}-${gap.message}`}>资料缺口 · {gap.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {suggestions.length === 0 ? (
                <p className="text-center text-[11px] leading-relaxed text-ink-3">
                  建议会显示在这里，并附上依据的规则与来源定位。
                </p>
              ) : (
                suggestions.map((suggestion) => (
                  <article
                    key={suggestion.id}
                    className={cn(
                      "rounded-md border border-line bg-sheet p-3 shadow-sm",
                      suggestion.status !== "pending" && "opacity-70",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          suggestion.status === "adopted"
                            ? "border-spot/40 text-spot"
                            : suggestion.status === "ignored"
                              ? "border-line text-ink-3"
                              : "border-brand/40 text-brand-deep",
                        )}
                      >
                        {STATUS_LABEL[suggestion.status]}
                      </span>
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

                    {/* 规则依据：显示规则名，红线标出来 */}
                    {suggestion.ruleKeys && suggestion.ruleKeys.length > 0 && (
                      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                        规则依据：
                        {suggestion.ruleKeys.map((key, index) => {
                          const rule = ruleByKey.get(key);
                          return (
                            <span key={key}>
                              {index > 0 ? "、" : ""}
                              {rule ? `${rule.displayName}（${key}${rule.isHard ? "，红线" : ""}）` : key}
                            </span>
                          );
                        })}
                      </p>
                    )}

                    {/* 来源证据：带定位，能看原页 */}
                    {suggestion.evidence && suggestion.evidence.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {suggestion.evidence.map((item) => (
                          <div key={item.sourceRef} className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-3">
                            <span>
                              {item.label}
                              {item.page == null ? "" : ` · 第 ${item.page} 页`}
                            </span>
                            <PageEvidence
                              label={item.label}
                              jobId={item.ocrJobId ?? null}
                              pageIndex={item.page == null ? null : item.page - 1}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {suggestion.uncertainty && (
                      <p className="mt-2 rounded border border-line bg-canvas/60 px-2 py-1 text-[10px] leading-relaxed text-ink-3">
                        不确定：{suggestion.uncertainty}
                      </p>
                    )}

                    <div className="mt-3 flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDismiss(suggestion.id)}
                        disabled={suggestion.status !== "pending"}
                      >
                        <X className="size-3.5" />
                        忽略
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => onApply(suggestion)}
                        disabled={
                          suggestion.status !== "pending" ||
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
