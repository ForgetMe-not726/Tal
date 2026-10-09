import type { ContentSuggestion } from "@/lib/types";

export type ApplyFailureReason =
  | "no_anchor"
  | "anchor_missing"
  | "no_replacement"
  | "unchanged";

export type ApplyResult =
  | { changed: true; markdown: string }
  | { changed: false; markdown: string; reason: ApplyFailureReason };

/**
 * 把一条建议应用到 Markdown 正文。
 * 只做首次精确锚点替换;失败时返回原因,由调用方决定提示,绝不静默成功。
 */
/**
 * 应用建议只需要这三样。**刻意不接收整个 `ContentSuggestion`**：
 * 调用方（如审校工作台）手里只有一条结论，不该为了调用它编一个 severity 或 confidence 出来。
 */
export type ApplicableSuggestion = Pick<
  ContentSuggestion,
  "kind" | "originalText" | "replacementText"
>;

export function applySuggestionToMarkdown(
  markdown: string,
  suggestion: ApplicableSuggestion,
): ApplyResult {
  if (suggestion.kind === "note" || !suggestion.originalText) {
    return { changed: false, markdown, reason: "no_anchor" };
  }
  if (!markdown.includes(suggestion.originalText)) {
    return { changed: false, markdown, reason: "anchor_missing" };
  }
  let next: string;
  if (suggestion.kind === "delete") {
    next = markdown.replace(suggestion.originalText, "");
  } else if (suggestion.kind === "insert") {
    next = markdown.replace(
      suggestion.originalText,
      `${suggestion.originalText}\n\n${suggestion.replacementText}`,
    );
  } else {
    if (!suggestion.replacementText) {
      return { changed: false, markdown, reason: "no_replacement" };
    }
    next = markdown.replace(suggestion.originalText, suggestion.replacementText);
  }
  return next === markdown
    ? { changed: false, markdown, reason: "unchanged" }
    : { changed: true, markdown: next };
}
