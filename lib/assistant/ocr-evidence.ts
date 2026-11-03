/**
 * 从一页 OCR 正文里定位命中页与页内块。
 *
 * 纯函数：不读工作区，测试可直接喂 `OcrCorpusDoc`。证据诚实原则：
 * - 找不到结构块时只返回页码，`blockId/box` 为 null；
 * - `content.md` 被老师改过、与 structure 不一致时，不拿旧块坐标冒充新文字。
 */

import type { AssistantBox } from "./text.ts";
import type { OcrCorpusDoc } from "./ocr-corpus.ts";
import { keywordPattern, normalizeBox, snippetAround } from "./text.ts";

export type OcrEvidence = {
  pageIndex: number;
  blockId: string | null;
  box: AssistantBox | null;
  snippet: string;
  count: number;
};

function blockText(block: { text?: string; html?: string }): string {
  if (block.text?.trim()) return block.text;
  if (!block.html) return "";
  return block.html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function locateOcrEvidence(doc: OcrCorpusDoc, keywords: readonly string[]): OcrEvidence | null {
  const pages = [...doc.pages.keys()].sort((a, b) => a - b);
  for (const pageIndex of pages) {
    const text = doc.pages.get(pageIndex) ?? "";
    const snippet = snippetAround(text, keywords);
    if (!snippet) continue;

    const pageBlocks = doc.blocks
      .filter((block) => block.pageIndex === pageIndex)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const hitBlock = pageBlocks.find((block) => {
      const value = blockText(block);
      return value.length > 0 && keywords.some((keyword) => keywordPattern(keyword).test(value));
    });
    return {
      pageIndex,
      blockId: hitBlock?.id ?? null,
      box: hitBlock ? normalizeBox(hitBlock.box) : null,
      snippet: snippet.snippet,
      count: snippet.count,
    };
  }
  return null;
}
