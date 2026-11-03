/**
 * 检索用的纯文本工具：HTML 表格、OCR 页码标记、关键词边界与页内高亮。
 *
 * OCR 的 `content.md` 保留了引擎原始 HTML 表格，`structure.json` 的表格块又把正文
 * 放在 `html` 而 `text` 为空；直接拿原文做关键词匹配会漏掉所有词卡/表格。这里统一
 * 转成可检索的纯文本，并把页码当作证据定位的一部分。
 *
 * 不依赖 Node/工作区，便于 `scripts/test-assistant.mjs` 直接测试。
 */

export type AssistantBox = { left: number; top: number; width: number; height: number };

/** 把 HTML 转成可搜索纯文本；不保留标签，单元格/行之间用空格分隔。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<\/(?:td|th)>/giu, " ")
    .replace(/<\/(?:tr|p|div|li|h[1-6])>/giu, "\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** 去掉 Markdown 标题/列表/引用前缀，保留可读正文。 */
function stripMarkdownPrefix(line: string): string {
  return line
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^>\s?/u, "")
    .replace(/^\s*[-*+]\s+/u, "")
    .replace(/^\s*\d+[.)]\s+/u, "")
    .trim();
}

/**
 * 按 `<!-- page N -->` 切页；没有标记时全部归到第 0 页。
 * 图片注释与其它 HTML 注释不进入正文；表格 HTML 转纯文本。
 */
export function parseContentPages(markdown: string): Map<number, string> {
  const pages = new Map<number, string>();
  let page = 0;
  const add = (text: string) => {
    if (!text) return;
    pages.set(page, `${pages.get(page) ?? ""}${text}\n`);
  };
  for (const raw of markdown.split(/\r?\n/u)) {
    const line = raw.trim();
    const marker = /^<!--\s*page\s+(\d+)\s*-->$/iu.exec(line);
    if (marker) {
      page = Number(marker[1]);
      continue;
    }
    if (!line || /^<!--[\s\S]*-->$/u.test(line)) continue;
    add(stripMarkdownPrefix(line.includes("<table") ? htmlToText(line) : line));
  }
  return pages;
}

/** 关键词匹配模式：英文卡词边界，中文按子串（与 match.ts 的规则一致）。 */
export function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ascii = /^[\x20-\x7e]+$/u.test(keyword);
  return new RegExp(ascii ? `\\b${escaped}\\b` : escaped, "giu");
}

/** 0..1 的页内坐标；无效或零面积返回 null，宁可只定位到页也不画错框。 */
export function normalizeBox(value: unknown): AssistantBox | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const numbers = ["left", "top", "width", "height"].map((key) => Number(source[key]));
  if (!numbers.every((item) => Number.isFinite(item))) return null;
  const [left, top, width, height] = numbers;
  if (width <= 0 || height <= 0) return null;
  return {
    left: Math.min(1, Math.max(0, left)),
    top: Math.min(1, Math.max(0, top)),
    width: Math.min(1 - Math.min(1, Math.max(0, left)), width),
    height: Math.min(1 - Math.min(1, Math.max(0, top)), height),
  };
}

/** 命中片段：保留命中词前后的上下文。 */
export function snippetAround(text: string, keywords: readonly string[], pad = 90, max = 320): { snippet: string; count: number } | null {
  const haystack = text.toLocaleLowerCase();
  let count = 0;
  let first = -1;
  for (const keyword of keywords) {
    for (const match of haystack.matchAll(keywordPattern(keyword))) {
      count += 1;
      if (first < 0 || match.index < first) first = match.index;
    }
  }
  if (count === 0 || first < 0) return null;
  const start = Math.max(0, first - pad);
  const raw = text.slice(start, start + max).trim();
  return {
    snippet: `${start > 0 ? "…" : ""}${raw}${start + max < text.length ? "…" : ""}`,
    count,
  };
}
