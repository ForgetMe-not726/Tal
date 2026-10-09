/**
 * 把生成的 Markdown 切成块级结构，供导出（DOCX）等非浏览器场景使用。
 *
 * 只覆盖生成管线实际产出的结构：标题、段落、GFM 表格、有序/无序列表。
 * 刻意不引入通用 Markdown 解析器——正文只有一个来源，块级语法是受控的。
 */

export type TableBlock = {
  kind: "table";
  header: string[];
  rows: string[][];
};

export type ListBlock = {
  kind: "list";
  ordered: boolean;
  items: string[];
};

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | ListBlock
  | TableBlock;

export type InlinePart = { text: string; bold: boolean };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const DELIMITER_CELL = /^:?-{2,}:?$/;

/** 拆一行表格：去掉首尾竖线后按竖线切分。生成内容里没有转义竖线。 */
function splitRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

/** GFM 表格的分隔行，例如 `| --- | :--: |`。 */
function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

function isStructuralLine(line: string): boolean {
  return (
    HEADING.test(line) ||
    line.trim().startsWith("|") ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    // 表格：本行是表头，且下一行是分隔行。
    if (line.trim().startsWith("|") && isDelimiterRow(lines[index + 1] ?? "")) {
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const orderedItem = ORDERED.exec(line);
    if (bullet || orderedItem) {
      const itemPattern = bullet ? BULLET : ORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const item = itemPattern.exec(lines[index]);
        if (!item) break;
        items.push(item[1].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered: !bullet, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isStructuralLine(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length === 0) {
      // 兜底：是结构行却没被上面的分支接住（例如孤立的分隔行），
      // 当成普通段落消费掉，保证循环一定前进。
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/** 拆出行内加粗片段。生成内容只用 `**加粗**`，其它标记按纯文本保留。 */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), bold: false });
  return parts.length > 0 ? parts : [{ text, bold: false }];
}
