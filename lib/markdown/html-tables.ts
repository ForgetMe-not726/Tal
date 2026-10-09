/**
 * 把旧版 OCR 里的 **HTML 表格** 转成 Markdown 表格。
 *
 * 为什么需要：MinerU 对网格型内容（练习册的「选正确字母补全单词」、词框、语法结构表、
 * 书末词表）直接输出 `<table><tr><td>…`，而 Markdown 不解析裸 HTML。这些标签会原样
 * 进 prompt，模型再照抄进成稿——实测练习册 Lesson 2 Day 1 的成稿里就是一段 16 个格子的
 * `<table>`，老师看到的是标签和挤成一行的选项。实测三本书的来源里共有 70 个 HTML 表格。
 *
 * 转换**只换表示形式**：不猜、不补、不删内容。三个刻意的取舍：
 *
 * 1. **不展开 `rowspan` / `colspan`**，合并单元格按单个格子输出。展开会把同一内容复制到
 *    多列，反而干扰模型；实测带合并单元格的语法结构表在展开前就已能正常生成。
 * 2. **首行只在用了 `<th>` 时当表头**。MinerU 的表大多全是 `<td>`，首行是数据
 *    （练习册 ①a 的第一行就是第 1 题），当成表头会把它降格成表头、丢掉"数据"身份。
 *    没有 `<th>` 时补一行空表头——这也是项目里既有的写法（见 table-templates 的学习目标表）。
 * 3. **单元格内换行转成「；」**。Markdown 表格单元格不能换行，与骨架里的要求一致。
 */

/** 一整块 `<table>…</table>`。非贪婪，够用——OCR 不产生嵌套表格。 */
const TABLE_BLOCK = /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi;
const TABLE_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
const TABLE_CELL = /<t([hd])\b[^>]*>([\s\S]*?)<\/t\1\s*>/gi;

/** 数字实体越界（含孤立代理项）时原样保留，不让 `fromCodePoint` 抛错。 */
function codePoint(value: number, fallback: string): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/** 解 HTML 实体。OCR 里常见的是 `&#x27;`（撇号）与 `&amp;`。 */
function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => codePoint(parseInt(hex, 16), whole))
      .replace(/&#(\d+);/g, (whole, dec: string) => codePoint(Number(dec), whole))
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      // `&amp;` 必须最后解：先解会把 `&amp;#x27;` 变成 `&#x27;` 再解一次。
      .replace(/&amp;/gi, "&")
  );
}

/** 一个单元格的文本。 */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "；").replace(/<[^>]*>/g, ""))
    .replace(/\s+/gu, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

type TableRow = { cells: string[]; header: boolean };

function parseRows(block: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const rowMatch of block.matchAll(TABLE_ROW)) {
    const cells: string[] = [];
    let header = false;
    for (const cellMatch of rowMatch[1].matchAll(TABLE_CELL)) {
      // 分组 1 是 `h` 或 `d`（`<t([hd])…>`），不是整个标签名。
      if (cellMatch[1].toLowerCase() === "h") header = true;
      cells.push(cellText(cellMatch[2]));
    }
    if (cells.length > 0) rows.push({ cells, header });
  }
  return rows;
}

/**
 * 把 Markdown 文本里的 HTML 表格全部换成 Markdown 表格。
 *
 * 文本里没有 `<table>` 时原样返回（这个函数会在生成管线的每个入口调用）。
 */
export function htmlTablesToMarkdown(markdown: string): string {
  if (!/<table/i.test(markdown)) return markdown;
  const converted = markdown.replace(TABLE_BLOCK, (block) => {
    const rows = parseRows(block);
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((row) => row.cells.length));
    // 空单元格写成 `| |`（不是 `|  |`）：与项目里其它表格的写法一致。
    const line = (cells: readonly string[]) =>
      `|${Array.from({ length: width }, (_, index) => {
        const cell = cells[index] ?? "";
        return cell ? ` ${cell} ` : " ";
      }).join("|")}|`;
    const usesHeader = rows[0].header;
    const header = usesHeader ? line(rows[0].cells) : line([]);
    const separator = line(Array.from({ length: width }, () => "---"));
    const body = (usesHeader ? rows.slice(1) : rows).map((row) => line(row.cells));
    return `\n\n${[header, separator, ...body].join("\n")}\n\n`;
  });
  return converted.replace(/\n{3,}/g, "\n\n");
}
