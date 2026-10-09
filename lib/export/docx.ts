/**
 * 知识清单 DOCX 导出。
 *
 * 版式按新版知识清单成稿（Lesson 9 在线文档）逐表还原：
 * A4、上下 2.54cm / 左右 3.17cm 页边距、正文 11pt、
 * 表格 0.5pt 黑色实线、单元格左右内边距 108 twips、列宽合计等于版心宽度。
 *
 * 四种板块表格的列宽、对齐、底色和合并方式各不相同，统一由 table-templates 判定，
 * 这里只负责把判定结果翻译成 OOXML。本文件不改动任何正文内容。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
// 相对路径带扩展名：Node 直接用 scripts/test-export.mjs 跑这个模块，需要能解析运行时导入。
import { parseInline, parseMarkdownBlocks, type ListBlock, type TableBlock } from "../markdown/blocks.ts";
import { resolveTableTemplate, type TableTemplate } from "../markdown/table-templates.ts";
import { readWordCardField } from "../markdown/word-card.ts";
import {
  normalizeHeadingDepths,
  normalizeModuleHeading,
  ordinalPrefix,
} from "../markdown/heading-levels.ts";

/** A4 版面与页边距，取自成稿的 sectPr。 */
const PAGE_WIDTH = 11900;
const PAGE_HEIGHT = 16840;
const PAGE_MARGIN = { top: 1440, right: 1800, bottom: 1440, left: 1800 };
/** 版心宽度 = 页宽 − 左右页边距；表格列宽按它换算。 */
const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN.left - PAGE_MARGIN.right;

const FONT = {
  ascii: "Arial Unicode MS",
  hAnsi: "Arial Unicode MS",
  eastAsia: "Microsoft YaHei",
  cs: "Arial Unicode MS",
};
/** 「学习目标」的标题和字段名在成稿里用 Arial。 */
const FONT_ARIAL = { ascii: "Arial", hAnsi: "Arial", eastAsia: "Arial", cs: "Arial" };

/** 字号用半磅表示：22 = 11pt。 */
const BODY_SIZE = 22;
const TITLE_SIZE = 32;
const LABEL_SIZE = 28;
const PHONETIC_SIZE = 24;
const HEADING_SPACING = 260;
const LINE_SPACING = 240;

/** 成稿里的强调色。 */
const LABEL_COLOR = "0070C0";
const PHONETIC_COLOR = "333333";
const SENTENCE_COLOR = "494949";

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" } as const;
const TABLE_BORDERS = {
  top: BORDER,
  bottom: BORDER,
  left: BORDER,
  right: BORDER,
  insideHorizontal: BORDER,
  insideVertical: BORDER,
};
const CELL_MARGIN = { top: 0, bottom: 0, left: 108, right: 108 };
/** 表头底色：派生词表和语法表用 f5f6fb，阅读技能用 efefef。 */
const HEADER_FILL = "f5f6fb";
const READING_SKILL_FILL = "efefef";

const NUMBERING_REFERENCE = "export-numbered";

export type DocxBlockInput = {
  moduleKey?: string;
  moduleLabel: string;
  markdown: string;
  /**
   * 正文标题（不含编号）与它在整课里的编号，由工作台按模块目录算好后传进来。
   * 导出保持纯函数、不依赖数据库——目录一改，这里跟着客户端的值走。
   * `heading` 为 null 表示该模块不显示独立标题（标题并进表格首行）。
   */
  heading?: string | null;
  ordinal?: number | null;
  /** 所属书种，用于按板块区分表格版式。 */
  bookType?: string;
};

export type DocxInput = {
  /** 文档标题，通常是文件名去掉扩展名。 */
  title: string;
  blocks: DocxBlockInput[];
};

type RunOptions = { bold?: boolean; size?: number; color?: string; font?: typeof FONT };

function textRun(text: string, options: RunOptions = {}): TextRun {
  return new TextRun({
    text,
    font: options.font ?? FONT,
    size: options.size ?? BODY_SIZE,
    bold: options.bold,
    color: options.color,
  });
}

function runs(text: string, options: RunOptions = {}): TextRun[] {
  return parseInline(text).map((part) =>
    textRun(part.text, { ...options, bold: options.bold ?? part.bold }),
  );
}

function paragraph(text: string, options: RunOptions & { center?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: runs(text, options),
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { line: LINE_SPACING },
  });
}

/**
 * 标题字号与大纲级别。
 *
 * 模块标题由 `normalizeModuleHeading` 重写成 `# 1. Let's say!`（或练习册的 `# Day 1`），
 * 小节由 `normalizeHeadingDepths` 压成从 `##` 开始的连续层级，再按 Markdown 层级映射：
 * 一级 16pt、二级 14pt、三级 13pt——正好对应成稿的模块标题 / 板块 / 大题。
 * 用真正的 Word 标题样式，Word 的导航窗格（大纲）才能显示出这个层级。
 */
const HEADING_SIZES = [32, 28, 26, 24, 22];
const HEADING_STYLES = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
];

function headingParagraph(level: number, text: string): Paragraph {
  const index = Math.min(Math.max(level, 1), HEADING_SIZES.length) - 1;
  return new Paragraph({
    // 显式给字号、加粗和黑色：Word 内置标题样式自带蓝色和别的字体，不覆盖会串味。
    children: [textRun(text, { bold: true, size: HEADING_SIZES[index], color: "000000" })],
    heading: HEADING_STYLES[index],
    spacing: { before: HEADING_SPACING, after: HEADING_SPACING, line: LINE_SPACING },
  });
}

function listParagraphs(block: ListBlock): Paragraph[] {
  return block.items.map((item) =>
    new Paragraph({
      children: runs(item),
      spacing: { line: LINE_SPACING },
      ...(block.ordered
        ? { numbering: { reference: NUMBERING_REFERENCE, level: 0 } }
        : { bullet: { level: 0 } }),
    }),
  );
}

/** 按百分比分配列宽，余数补到最后一列，保证合计等于版心宽度。 */
function columnWidths(percentages: number[]): number[] {
  const widths = percentages.map((percent) => Math.round((USABLE_WIDTH * percent) / 100));
  const sum = widths.reduce((total, width) => total + width, 0);
  widths[widths.length - 1] += USABLE_WIDTH - sum;
  return widths;
}

function equalWidths(columnCount: number): number[] {
  const base = Math.floor(USABLE_WIDTH / columnCount);
  const widths = Array.from({ length: columnCount }, () => base);
  widths[columnCount - 1] = USABLE_WIDTH - base * (columnCount - 1);
  return widths;
}

function padRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

/** 各板块的列宽（占版心百分比），取自成稿的 tblGrid。 */
const COLUMN_PERCENT: Partial<Record<TableTemplate, number[]>> = {
  "word-card": [22, 22, 22, 34],
  objectives: [14.5, 85.5],
  derived: [25, 25, 25, 25],
  "reading-skill": [33.4, 33.3, 33.3],
  grammar: [21, 30.2, 48.8],
};

type CellOptions = {
  bold?: boolean;
  center?: boolean;
  fill?: string;
  columnSpan?: number;
  size?: number;
  color?: string;
  font?: typeof FONT;
  /** TableCell 只接受 center/top/bottom，VerticalAlign 里的 both 用不上。 */
  vAlign?: "center" | "top" | "bottom";
};

function tableCell(content: string | Paragraph[], width: number, options: CellOptions = {}): TableCell {
  const paragraphs = Array.isArray(content)
    ? content
    : [
        paragraph(content, {
          bold: options.bold,
          size: options.size,
          color: options.color,
          font: options.font,
          center: options.center,
        }),
      ];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan,
    verticalAlign: options.vAlign ?? VerticalAlign.TOP,
    shading: options.fill ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill } : undefined,
    children: paragraphs,
  });
}

function tableRows(rows: TableRow[], widths: number[]): Table {
  return new Table({
    width: { size: USABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: TABLE_BORDERS,
    margins: CELL_MARGIN,
    rows,
  });
}

/** 表头行：底色 + 加粗，对齐方式按板块区分。 */
function headerRow(header: string[], widths: number[], fill: string, center: boolean): TableRow {
  return new TableRow({
    children: header.map((cell, index) =>
      tableCell(cell, widths[index], { bold: true, center, fill }),
    ),
  });
}

function buildWordCard(block: TableBlock, widths: number[]): Table {
  const rows: TableRow[] = [
    // 成稿里词卡表头不加底色也不加粗。
    new TableRow({ children: block.header.map((cell, index) => tableCell(cell, widths[index])) }),
  ];

  block.rows.forEach((row, index) => {
    // 释义/搭配/拓展/例句：合并成整行。
    // readWordCardField 同时认正常形状和早期往返损坏过的形状。
    const field = readWordCardField(row);
    if (field) {
      rows.push(
        new TableRow({
          children: [tableCell(`${field.label}：${field.value}`, USABLE_WIDTH, { columnSpan: 4 })],
        }),
      );
      return;
    }
    const values = padRow(row, 4);
    rows.push(
      new TableRow({
        children: values.map((cell, column) =>
          // 第一行是取值行，第三列音标在成稿里是 12pt 深灰。
          tableCell(cell, widths[column], {
            size: index === 0 && column === 2 ? PHONETIC_SIZE : undefined,
            color: index === 0 && column === 2 ? PHONETIC_COLOR : undefined,
          }),
        ),
      }),
    );
  });

  return tableRows(rows, widths);
}

/**
 * 「学习目标」：成稿没有独立的标题段落，标题是表格首行跨列居中，
 * 字段名用 Arial 14pt 蓝色，取值列用正文样式。
 */
function buildObjectives(block: TableBlock, title: string | undefined): Table {
  const widths = columnWidths(COLUMN_PERCENT.objectives ?? [14.5, 85.5]);
  const rows: TableRow[] = [];

  if (title) {
    rows.push(
      new TableRow({
        children: [
          tableCell([paragraph(title, { font: FONT_ARIAL, size: TITLE_SIZE, center: true })], USABLE_WIDTH, {
            columnSpan: 2,
          }),
        ],
      }),
    );
  }

  for (const row of block.rows) {
    const values = padRow(row, 2);
    rows.push(
      new TableRow({
        children: [
          tableCell(values[0], widths[0], { font: FONT_ARIAL, size: LABEL_SIZE, color: LABEL_COLOR }),
          tableCell(values[1], widths[1]),
        ],
      }),
    );
  }

  return tableRows(rows, widths);
}

/** 「阅读词汇」：成稿是一列，单元格内词条加粗、例句灰色，两段上下排列。 */
function buildTermExample(block: TableBlock): Table {
  const rows = block.rows.map((row) => {
    const values = padRow(row, 2);
    return new TableRow({
      children: [
        tableCell(
          [
            paragraph(values[0], { bold: true }),
            paragraph(values[1], { color: SENTENCE_COLOR }),
          ],
          USABLE_WIDTH,
        ),
      ],
    });
  });
  return tableRows(rows, [USABLE_WIDTH]);
}

function buildGrammar(block: TableBlock, widths: number[]): Table {
  const rows: TableRow[] = [headerRow(block.header, widths, HEADER_FILL, true)];
  for (const row of block.rows) {
    const values = padRow(row, 3);
    rows.push(
      new TableRow({
        children: values.map((cell, column) =>
          tableCell(cell, widths[column], {
            // 成稿里语法结构那一列加粗并垂直居中，用法和例句保持正文样式。
            bold: column === 0 ? true : undefined,
            vAlign: column === 0 ? VerticalAlign.CENTER : VerticalAlign.TOP,
          }),
        ),
      }),
    );
  }
  return tableRows(rows, widths);
}

function buildTable(
  block: TableBlock,
  moduleKey: string | undefined,
  bookType: string | undefined,
  title: string | undefined,
): Table {
  const template = resolveTableTemplate({ bookType, moduleKey }, block.header);
  const columnCount = block.header.length;
  const widths =
    template === "term-example" || template === "generic"
      ? equalWidths(columnCount)
      : columnWidths(COLUMN_PERCENT[template] ?? Array.from({ length: columnCount }, () => 100 / columnCount));

  switch (template) {
    case "word-card":
      return buildWordCard(block, widths);
    case "objectives":
      return buildObjectives(block, title);
    case "term-example":
      return buildTermExample(block);
    case "grammar":
      return buildGrammar(block, widths);
    case "reading-skill":
    case "derived":
    case "generic": {
      const fill = template === "reading-skill" ? READING_SKILL_FILL : HEADER_FILL;
      // 阅读技能的表头在成稿里是左对齐，其余板块居中。
      const center = template !== "reading-skill";
      const rows: TableRow[] = [headerRow(block.header, widths, fill, center)];
      for (const row of block.rows) {
        const values = padRow(row, columnCount);
        rows.push(
          new TableRow({
            children: values.map((cell, column) =>
              tableCell(cell, widths[column], {
                // 派生词表取值都很短，成稿里居中并垂直居中。
                center: template === "derived",
                vAlign: template === "derived" ? VerticalAlign.CENTER : VerticalAlign.TOP,
              }),
            ),
          }),
        );
      }
      return tableRows(rows, widths);
    }
  }
}

export async function buildDocx(input: DocxInput): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [headingParagraph(1, input.title)];

  for (const block of input.blocks) {
    const ordinal = block.ordinal ?? null;
    const heading = block.heading ?? null;
    // 和工作台用同一份规范化：
    // - 编号模块 → `# 1. Let's say!`
    // - 不编号但有自己的标题（学生用书主题页）→ `# In this lesson, we will...`，保留不带号
    // - heading 为 null（知识清单「学习目标」）→ 去掉标题行，标题并进表格首行
    const markdown = normalizeHeadingDepths(
      normalizeModuleHeading(block.markdown, heading ? `${ordinalPrefix(ordinal)}${heading}` : null),
    );
    const parsed = parseMarkdownBlocks(markdown);

    for (const item of parsed) {
      if (item.kind === "heading") {
        // 层级已在 heading-levels 里规整过，直接按 Markdown 层级映射。
        children.push(headingParagraph(item.level, item.text));
      } else if (item.kind === "paragraph") children.push(paragraph(item.text));
      else if (item.kind === "list") children.push(...listParagraphs(item));
      else {
        // 标题并进表格首行的模块（知识清单「学习目标」）用显示名当首行文字。
        const tableTitle = heading === null ? block.moduleLabel : undefined;
        children.push(buildTable(item, block.moduleKey, block.bookType, tableTitle));
      }
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
    numbering: {
      config: [
        {
          reference: NUMBERING_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 420, hanging: 420 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: PAGE_MARGIN,
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
