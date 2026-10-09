/**
 * 正文锚点：把一条 Finding 定位到正文里的哪一段。
 *
 * 用**子串语义**，与 `lib/suggestions/apply.ts` 一致——那一套已经在用，语义经过验证：
 * 引文找得到就定位，找不到就明说找不到。**不引入偏移层**：`lib/markdown/blocks.ts`
 * 本来就不带行号/偏移，而界面定位靠 DOM 搜索（见 `MarkdownContent` 的 `highlightQuote`），
 * 再加一层偏移只会多一处需要同步的状态。
 */

import type { ReviewAnchor } from "./types.ts";

/**
 * 把正文按空行切成块（与 `parseMarkdownBlocks` 的分块口径一致，但**保留偏移**，
 * 只在本模块内用于算 `blockIndex`）。
 */
export function textBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * 用引文定位。
 *
 * 引文为空、找不到、或只由空白组成时返回 `blockIndex: null`——**不猜**。
 * `quote` 本身原样保留：报告要引用它，界面要拿它做高亮。
 */
export function locateQuote(markdown: string, quote: string): ReviewAnchor {
  const needle = quote.trim();
  if (!needle) return { quote: "", blockIndex: null };
  const index = markdown.indexOf(needle);
  if (index < 0) return { quote: needle, blockIndex: null };
  // 数一数它前面有几个块分隔
  const before = markdown.slice(0, index);
  const blockIndex = textBlocks(before).length;
  return { quote: needle, blockIndex };
}

/** 从正文里截一段可读的引文（用于没有精确命中时的上下文展示）。 */
export function excerptAround(markdown: string, needle: string, radius = 40): string | null {
  const index = markdown.indexOf(needle);
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(markdown.length, index + needle.length + radius);
  return markdown.slice(start, end).replace(/\s+/gu, " ").trim();
}
