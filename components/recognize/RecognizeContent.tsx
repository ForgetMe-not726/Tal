"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { LegacyLessonPackage } from "@/lib/knowledge/legacy-markdown";
import type { OcrBlock } from "@/lib/ocr/types";
import type { OcrJobStatus } from "@/lib/ocr/types";
import { cn } from "@/lib/utils";

export type RecognizeContentProps = {
  status: OcrJobStatus;
  pageIndex: number;
  blocks: OcrBlock[];
  lowConfidence: string[];
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  /** 点原页上的块 → 把对应文字在正文里选中。 */
  focusText: string | null;
  onFocusConsumed: () => void;
  dirty: boolean;
  saving: boolean;
  confirming: boolean;
  onSave: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  /** 切分核对：这份 OCR 会被切成什么。 */
  packages: LegacyLessonPackage[];
  warnings: string[];
};

const TYPE_LABEL: Record<string, string> = {
  title: "标题",
  text: "正文",
  table: "表格",
  image: "图片",
  list: "列表",
  header: "页眉",
  footer: "页脚",
  page_number: "页码",
  aside: "旁注",
  other: "其他",
};

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

/**
 * 结构化结果：块列表 + 可编辑正文 + 切分核对 + 确认。
 *
 * 确认是**唯一**把 OCR 结果变成正式来源的动作，所以它是这一栏里唯一的主按钮；
 * 确认前整栏用琥珀色提示（DESIGN.md：确认前的结果不能显示为正式来源）。
 */
export function RecognizeContent({
  status,
  pageIndex,
  blocks,
  lowConfidence,
  markdown,
  onMarkdownChange,
  focusText,
  onFocusConsumed,
  dirty,
  saving,
  confirming,
  onSave,
  onConfirm,
  onRetry,
  packages,
  warnings,
}: RecognizeContentProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showSplit, setShowSplit] = React.useState(false);

  // 原页上点了块 → 在正文里选中那段文字（"原页与结构化结果互相定位"）
  React.useEffect(() => {
    if (!focusText) return;
    const node = textareaRef.current;
    if (!node) return;
    const index = markdown.indexOf(focusText);
    if (index >= 0) {
      node.focus();
      node.setSelectionRange(index, index + focusText.length);
      // 粗略滚动到选中位置（按字符比例估算行号）
      const ratio = index / Math.max(1, markdown.length);
      node.scrollTop = ratio * node.scrollHeight - node.clientHeight / 2;
    }
    onFocusConsumed();
  }, [focusText, markdown, onFocusConsumed]);

  const pageBlocks = blocks.filter((block) => block.pageIndex === pageIndex);
  const confirmed = status === "confirmed";
  const blocked = status === "running" || status === "normalizing" || status === "queued";

  return (
    <div className="flex h-full w-[440px] shrink-0 flex-col border-l border-line bg-paper">
      <div
        className={cn(
          "border-b border-line px-4 py-2.5",
          confirmed ? "bg-reg-tint/40" : "bg-amber-50/60",
        )}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          {confirmed ? (
            <Check className="size-3.5 text-reg" />
          ) : (
            <AlertTriangle className="size-3.5 text-amber-600" />
          )}
          {STATUS_LABEL[status]}
        </h2>
        <p className="mt-0.5 text-[10px] leading-relaxed text-ink-2">
          {confirmed
            ? "已加入资料库，制作页可以选它作为旧版来源。"
            : blocked
              ? "识别进行中，完成后可以修订正文。"
              : "核对无误后点「确认并加入资料库」，确认前不会用于生成。"}
        </p>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-0.5 border-b border-line px-4 py-2 text-[10px] leading-relaxed text-ink-2">
          {warnings.map((warning) => (
            <li key={warning}>· {warning}</li>
          ))}
        </ul>
      )}

      {/* 本页的块：点一行就在正文里选中对应文字 */}
      <div className="max-h-40 shrink-0 overflow-y-auto border-b border-line px-3 py-2">
        <p className="mb-1 text-[10px] font-medium text-ink-2">
          第 {pageIndex + 1} 页的块（{pageBlocks.length}）
        </p>
        <ul className="space-y-0.5">
          {pageBlocks.map((block) => (
            <li
              key={block.id}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-2"
            >
              <span className="shrink-0 rounded bg-canvas px-1 text-[9px] text-ink-3">
                {TYPE_LABEL[block.type] ?? block.type}
              </span>
              {lowConfidence.includes(block.id) && (
                <span className="shrink-0 text-[9px] text-amber-700">低分</span>
              )}
              <span className="min-w-0 truncate" title={block.text}>
                {block.text || (block.html ? "（表格）" : block.assetPath ? "（图片）" : "—")}
              </span>
            </li>
          ))}
          {pageBlocks.length === 0 && <li className="text-[10px] text-ink-3">本页没有识别到块</li>}
        </ul>
      </div>

      {/* 正文：识别结果的工作稿，老师直接改 */}
      <textarea
        ref={textareaRef}
        value={markdown}
        onChange={(event) => onMarkdownChange(event.target.value)}
        disabled={blocked || confirmed}
        spellCheck={false}
        aria-label="识别结果正文"
        className="min-h-0 flex-1 resize-none border-0 bg-sheet px-4 py-3 text-[13px] leading-6 text-ink outline-none disabled:opacity-70"
      />

      {/* 切分核对：让老师看到这份 OCR 会被切成什么 */}
      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => setShowSplit((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] text-ink-2 transition-colors hover:bg-canvas/60"
        >
          <span>切分核对：{packages.length} 个讲次</span>
          <span className="text-[10px] text-ink-3">{showSplit ? "收起" : "展开"}</span>
        </button>
        {showSplit && (
          <ul className="max-h-40 overflow-y-auto px-4 pb-2 text-[10px] leading-relaxed text-ink-2">
            {packages.map((pkg) => (
              <li key={pkg.sourceLessonNumber} className="border-t border-line/60 py-1">
                <span className="font-medium">第 {pkg.sourceLessonNumber} 讲</span>
                <span className="text-ink-3"> · {pkg.candidates.length} 个来源块</span>
                <span className="block truncate text-ink-3">
                  {[...new Set(pkg.candidates.map((item) => item.sectionKey))].join("、") || "（没有可识别的栏目）"}
                </span>
              </li>
            ))}
            {packages.length === 0 && (
              <li className="py-1 text-amber-800">
                没有切出任何讲次——请检查课号是否在页眉/正文标题里（如 `# Unit 1`、`# 第1讲`）。
              </li>
            )}
          </ul>
        )}
      </div>

      {/* 操作栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          disabled={!dirty || saving || blocked || confirmed}
          onClick={onSave}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep disabled:opacity-50"
        >
          {saving ? "保存中…" : dirty ? "保存修订" : "已保存"}
        </button>
        {(status === "failed" || status === "interrupted" || status === "cancelled") && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep"
          >
            重新识别
          </button>
        )}
        <button
          type="button"
          disabled={confirmed || blocked || dirty || confirming}
          onClick={onConfirm}
          title={dirty ? "先保存修订" : undefined}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
            "bg-brand hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {confirming && <Loader2 className="size-3.5 animate-spin" />}
          {confirmed ? "已加入资料库" : "确认并加入资料库"}
        </button>
      </div>
    </div>
  );
}
