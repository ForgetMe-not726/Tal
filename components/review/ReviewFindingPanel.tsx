"use client";

import * as React from "react";
import { Check, Eye, FileText, Loader2 } from "lucide-react";
import type { ReviewFinding } from "@/lib/review/types";
import { cn } from "@/lib/utils";

/**
 * 列表标记按**处理状态**着色，不按严重度（审校标准明确不新增严重度字段）。
 *
 * 状态是老师真正要看的：哪些还没处理、哪些已处理。颜色必须同时配图标与文字
 * （DESIGN.md：颜色不能单独承载语义）。
 */
const STATE_STYLE: Record<
  "pending" | "adopt" | "ignore" | "recheck",
  { text: string; border: string; label: string; icon: React.ReactNode }
> = {
  pending: { text: "text-ink-2", border: "border-l-ink-3", label: "待处理", icon: <FileText className="size-3.5" /> },
  adopt: { text: "text-spot", border: "border-l-spot", label: "已采用", icon: <Check className="size-3.5" /> },
  ignore: { text: "text-ink-3", border: "border-l-line", label: "已忽略", icon: <Eye className="size-3.5" /> },
  recheck: { text: "text-brand-deep", border: "border-l-brand", label: "待复查", icon: <Eye className="size-3.5" /> },
};

export type ReviewFindingPanelProps = {
  finding: ReviewFinding | null;
  /** 该 Finding 对应规则的依据链接（源行与判据），来自 manifest 的规则快照。 */
  ruleBasis: { reviewListRefs?: string[]; standardRefs?: string[] } | null;
  /** 过滤后的清单（点一条就选中并定位）。 */
  findings: ReviewFinding[];
  onSelect: (findingId: string) => void;
  deciding: boolean;
  onDecide: (findingId: string, action: "adopt" | "ignore" | "recheck", note?: string) => void;
  onAdoptSuggestion: (finding: ReviewFinding) => void;
  adopting: boolean;
  /** 草稿与所审版本不一致时提示（采用建议前要基于同一版）。 */
  draftDirty: boolean;
  reportReady: boolean;
  generatingReport: boolean;
  onGenerateReport: () => void;
  onViewReport: () => void;
  viewingReport: boolean;
  jobStatus: string;
};

export function ReviewFindingPanel({
  finding,
  ruleBasis,
  findings,
  onSelect,
  deciding,
  onDecide,
  onAdoptSuggestion,
  adopting,
  draftDirty,
  reportReady,
  generatingReport,
  onGenerateReport,
  onViewReport,
  viewingReport,
  jobStatus,
}: ReviewFindingPanelProps) {
  // 备注框跟着选中的问题走：用 React 的"渲染期同步派生状态"写法，
  // 而不是在 effect 里 setState（那会触发级联渲染，lint 也不允许）。
  const [note, setNote] = React.useState("");
  const [noteFor, setNoteFor] = React.useState<string | null>(finding?.id ?? null);
  if (noteFor !== (finding?.id ?? null)) {
    setNoteFor(finding?.id ?? null);
    setNote(finding?.decision?.note ?? "");
  }

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-paper">
      <div className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">问题与处理</h2>
        <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
          {findings.length} 条待看 · 采用建议只改当前草稿，保存后才生成新版本
        </p>
      </div>

      {/* 清单：点一条跳到正文对应位置 */}
      <div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-line px-3 py-2">
        <ul className="space-y-1">
          {findings.map((item) => {
            const style = STATE_STYLE[item.decision?.action ?? "pending"];
            const active = item.id === finding?.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "w-full rounded-md border border-l-[3px] border-line bg-paper px-2 py-1.5 text-left transition-colors",
                    style.border,
                    active ? "border-brand/40 bg-brand-tint/40" : "hover:border-brand/30 hover:bg-canvas/60",
                  )}
                >
                  <span className={cn("flex items-center gap-1 text-[10px] font-medium", style.text)}>
                    {style.icon}
                    {item.ruleKey}
                    {item.insufficientEvidence && <span className="text-ink-3">· 资料不足</span>}
                    {item.unverified && <span className="text-amber-700">· 未核实</span>}
                    {item.decision && <span className="text-ink-3">（{style.label}）</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-2" title={item.message}>
                    {item.message}
                  </span>
                </button>
              </li>
            );
          })}
          {findings.length === 0 && (
            <li className="px-2 py-3 text-center text-[10px] text-ink-3">
              {jobStatus === "ready" ? "没有符合筛选条件的问题" : "还没有审校结果"}
            </li>
          )}
        </ul>
      </div>

      {/* 详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {finding ? (
          <div className="space-y-2 text-[11px] leading-relaxed text-ink-2">
            <p className="text-sm font-medium text-ink">{finding.message}</p>
            <p className="text-[10px] text-ink-3">
              {finding.bookType}/{finding.moduleKey} · v{finding.versionNumber} · 阶段 {finding.stage}
              {finding.confidence != null ? ` · 置信 ${(finding.confidence * 100).toFixed(0)}%` : ""}
            </p>
            {!finding.anchor.quote && (
              <p className="text-[10px] text-ink-3">
                无正文定位（这类结论通常是「某处缺内容」，也可能是模型看错了——请对照原稿核对）
              </p>
            )}
            {finding.anchor.quote && (
              <div>
                <p className="font-medium text-ink-2">正文定位</p>
                <p className="rounded border border-line bg-sheet px-2 py-1 font-serif text-[12px]">
                  {finding.anchor.quote}
                </p>
              </div>
            )}
            {finding.evidence && (
              <div>
                <p className="font-medium text-ink-2">依据</p>
                <p>{finding.evidence}</p>
              </div>
            )}
            {finding.suggestion && (
              <div>
                <p className="font-medium text-ink-2">建议</p>
                <p className="rounded border border-line bg-canvas/50 px-2 py-1">{finding.suggestion}</p>
              </div>
            )}
            {finding.unverified && (
              <p className="rounded border border-amber-300 bg-amber-50/60 px-2 py-1 text-[10px] text-amber-900">
                这条没有能在正文里定位到的依据——可能是模型看错了，请先核对再决定。
              </p>
            )}
            {finding.insufficientEvidence && (
              <p className="rounded border border-line bg-canvas/60 px-2 py-1 text-[10px] text-ink-3">
                资料不足，未能判定——需人工核对或补充资料。
              </p>
            )}
            {finding.sourceRefs && finding.sourceRefs.length > 0 && (
              <p className="text-[10px] text-ink-3">来源：{finding.sourceRefs.join("、")}</p>
            )}
            {/* 审校标准自己的环节（language / answer / exam…）。
                刻意不叫「阶段」——工作台的「阶段」指 Pipeline 的八段，两套词混用会看不懂。 */}
            {finding.phase && <p className="text-[10px] text-ink-3">标准环节：{finding.phase}</p>}
            {ruleBasis?.reviewListRefs && ruleBasis.reviewListRefs.length > 0 && (
              <p className="text-[10px] leading-relaxed text-ink-3">
                规则依据（审校清单源行）：{ruleBasis.reviewListRefs.slice(0, 8).join("、")}
                {ruleBasis.reviewListRefs.length > 8 ? ` 等 ${ruleBasis.reviewListRefs.length} 项` : ""}
              </p>
            )}
            {ruleBasis?.standardRefs && ruleBasis.standardRefs.length > 0 && (
              <p className="text-[10px] leading-relaxed text-ink-3">
                判据：{ruleBasis.standardRefs.join("；")}
              </p>
            )}

            <div className="space-y-1.5 border-t border-line pt-2">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="人工意见（可选）"
                rows={2}
                className="w-full rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-brand"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={deciding || !finding.suggestion || draftDirty}
                  onClick={() => onAdoptSuggestion(finding)}
                  title={
                    draftDirty
                      ? "草稿已改动，先保存或重新载入这一版"
                      : finding.suggestion
                        ? undefined
                        : "这条没有可执行的建议"
                  }
                  className="flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
                >
                  {adopting ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  采用建议
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => onDecide(finding.id, "ignore", note)}
                  className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep disabled:opacity-50"
                >
                  忽略
                </button>
                <button
                  type="button"
                  disabled={deciding}
                  onClick={() => onDecide(finding.id, "recheck", note)}
                  className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep disabled:opacity-50"
                >
                  <Eye className="size-3" />
                  标记复查
                </button>
              </div>
              {draftDirty && (
                <p className="text-[10px] leading-relaxed text-amber-800">
                  草稿与所审版本不一致：先保存草稿，采用建议才会基于同一版。
                </p>
              )}
              {finding.decision && (
                <p className="text-[10px] text-ink-3">
                  已处理：{finding.decision.action === "adopt" ? "采用" : finding.decision.action === "ignore" ? "忽略" : "待复查"}
                  {finding.decision.note ? `（${finding.decision.note}）` : ""}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-8 text-center text-[11px] leading-relaxed text-ink-3">
            左侧选一条问题查看依据与建议。
          </p>
        )}
      </div>

      {/* 主操作按阶段变化：开始审校（在左栏）→ 生成报告 → 查看报告 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          disabled={jobStatus !== "ready" || generatingReport}
          onClick={onGenerateReport}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep disabled:opacity-50"
        >
          {generatingReport && <Loader2 className="size-3.5 animate-spin" />}
          {reportReady ? "重新生成报告" : "生成审校报告"}
        </button>
        <button
          type="button"
          disabled={!reportReady}
          onClick={onViewReport}
          className={cn(
            "ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
            "bg-brand hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {viewingReport ? "返回正文" : "查看报告"}
        </button>
      </div>
    </div>
  );
}
