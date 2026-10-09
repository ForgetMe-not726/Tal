import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { parseInline, parseMarkdownBlocks } from "../lib/markdown/blocks.ts";
import {
  isWordCardHeader,
  isWordCardFieldRow,
  readWordCardField,
  splitMergedField,
  VOCAB_CARD_HEADER,
} from "../lib/markdown/word-card.ts";
import {
  moduleOrdinal,
  normalizeHeadingDepths,
  normalizeModuleHeading,
  ordinalPrefix,
} from "../lib/markdown/heading-levels.ts";
import { findModuleOutline, ordinalOf } from "../lib/modules/directory.ts";
import { resolveTableTemplate } from "../lib/markdown/table-templates.ts";
import { buildDocx } from "../lib/export/docx.ts";

const CARD_HEADER = "| 难度 | 词汇 | 音标 | 词性和含义 |";
const CARD_TABLE = [
  CARD_HEADER,
  "| --- | --- | --- | --- |",
  "| B2 | admission | /ədˈmɪʃn/ | n. 准许进入；入学 |",
  "| 释义 | permission to enter a place | | |",
  "| 例句 | He applied for admission.；他申请了入学资格。 | | |",
].join("\n");
// 模块正文的第一个标题就是模块标题，规范化时会被换成 `# 1. Let's say!`，
// 所以词卡这种用例也要带上模块标题，才是生成管线真实产出的形状。
const CARD_MARKDOWN = ["## Let's say!", "", "### 核心词汇", "", CARD_TABLE].join("\n");

const DERIVED_MARKDOWN = [
  "| 名词 | 动词 | 形容词 | 副词 |",
  "| --- | --- | --- | --- |",
  "| admission | admit | admissible | / |",
  "| education；educator | educate | educational | educationally |",
].join("\n");

const TERM_EXAMPLE_MARKDOWN = [
  "| 词汇 | 原句 |",
  "| --- | --- |",
  "| geology n. 地质学 | My mother is a university lecturer in geology. |",
].join("\n");

const READING_SKILL_MARKDOWN = [
  "| 题目中的核心词 | 文章中的相似表达 | 替换技巧 |",
  "| --- | --- | --- |",
  "| Q1: Which teenager is creative? | Text: \"doing things that are creative\" | artistic 被替换为 creative。 |",
].join("\n");

const GRAMMAR_MARKDOWN = [
  "| 时态/结构 | 用法 | 例句 |",
  "| --- | --- | --- |",
  "| 一般现在时 | 时间表上安排好的事情 | The music festival starts at 7:00 PM. |",
].join("\n");

const OBJECTIVES_MARKDOWN = [
  "## 学习目标",
  "",
  "| | |",
  "| --- | --- |",
  "| 目标词汇 | admission, assignment, bright |",
  "| 核心语法 | Future Forms: Review & Extension |",
].join("\n");

const LETS_SAY_MARKDOWN = [
  CARD_MARKDOWN,
  "",
  "### FCE 重难点派生词表",
  "",
  DERIVED_MARKDOWN,
].join("\n");

const LETS_READ_MARKDOWN = [
  "## Let's read!",
  "",
  "### 阅读词汇",
  "",
  TERM_EXAMPLE_MARKDOWN,
  "",
  "### 阅读技能",
  "",
  READING_SKILL_MARKDOWN,
].join("\n");

const LETS_TALK_MARKDOWN = [
  "## Let's talk!",
  "",
  "### 情态动词表推测与推断",
  "",
  GRAMMAR_MARKDOWN,
].join("\n");

/** 从 DOCX（zip）里读出指定 part 的文本，用于断言导出的 OOXML。 */
function readZipEntry(buffer, entryName) {
  const endSignature = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === endSignature) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, "找不到 zip 中央目录");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "中央目录条目签名不对");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.fail(`zip 里没有 ${entryName}`);
}

/**
 * 导出单个模块并取出它的表格 XML。
 *
 * 导出是纯函数：标题与编号由调用方（工作台）按模块目录算好后传进来，
 * 这里照做一遍，与真实调用保持一致。
 */
async function tablesOfModule(moduleKey, markdown, bookType = "knowledge") {
  const buffer = await buildDocx({
    title: "Lesson 9 The next step",
    blocks: [exportBlock({ moduleKey, markdown, bookType })],
  });
  const doc = readZipEntry(buffer, "word/document.xml");
  return [...doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((match) => match[0]);
}

/** 按目录补上 heading 与 ordinal，模拟工作台的传参。 */
function exportBlock({ moduleKey, moduleLabel, markdown, bookType = "knowledge", lessonType = "regular" }) {
  const definition = findModuleOutline(bookType, moduleKey);
  return {
    moduleKey,
    moduleLabel: moduleLabel ?? definition?.displayName ?? moduleKey,
    bookType,
    heading: definition?.heading ?? null,
    ordinal: ordinalOf(bookType, moduleKey, lessonType),
    markdown,
  };
}

function rowsOf(table) {
  return [...table.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
}

function cellsOf(row) {
  return [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((match) => match[0]);
}

function textOfCell(cell) {
  return [...cell.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join("");
}

function gridWidthsOf(table) {
  const grid = /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.exec(table)[0];
  return [...grid.matchAll(/w:w="(\d+)"/g)].map((match) => Number(match[1]));
}

function testWordCardHeaderMatches() {
  assert.equal(isWordCardHeader(["难度", "词汇", "音标", "词性和含义"]), true);
  assert.equal(isWordCardHeader([...VOCAB_CARD_HEADER]), true);
}

function testDerivedTableIsNotWordCard() {
  // 派生词表同样是四列，不能被当成词卡，否则字段行会被误合并。
  assert.equal(isWordCardHeader(["名词", "动词", "形容词", "副词"]), false);
  assert.equal(isWordCardHeader(["难度", "词汇", "音标"]), false);
  assert.equal(isWordCardHeader([]), false);
}

function testWordCardFieldRowDetection() {
  // 正常形状：字段名在第一列，后两列留空
  assert.equal(isWordCardFieldRow(["释义", "having no purpose", "", ""]), true);
  // 取值行四列都有内容，不是字段行
  assert.equal(isWordCardFieldRow(["C1", "pointless", "/ˈpɔɪntləs/", "adj. 无意义的"]), false);
  // 列数不足
  assert.equal(isWordCardFieldRow(["释义", "having no purpose"]), false);
  // 往返损坏过的形状：取值被并回第一列，靠 splitMergedField 兜底
  assert.deepEqual(splitMergedField("释义：having no purpose"), {
    label: "释义",
    value: "having no purpose",
  });
  // 取值里本身有冒号时，只按第一个全角冒号拆
  assert.deepEqual(splitMergedField("例句：He said：hi"), { label: "例句", value: "He said：hi" });
  assert.equal(splitMergedField("没有冒号"), null);
  assert.equal(splitMergedField("：只有取值"), null);
  // readWordCardField 两种形状都要认出来
  assert.deepEqual(readWordCardField(["释义", "having no purpose", "", ""]), {
    label: "释义",
    value: "having no purpose",
  });
  assert.deepEqual(readWordCardField(["释义：having no purpose", "", "", ""]), {
    label: "释义",
    value: "having no purpose",
  });
  assert.equal(readWordCardField(["C1", "pointless", "/ˈpɔɪntləs/", "adj. 无意义的"]), null);
  // 第一列是字段名但取值为空，读不出字段行
  assert.equal(readWordCardField(["释义", "", "", ""]), null);
}

function testModuleOrdinals() {
  // 编号顺序由调用方按模块目录传进来，这里不写死模块清单
  const knowledgeKeys = ["lets_say", "lets_read", "lets_talk"];
  assert.equal(moduleOrdinal("lets_say", knowledgeKeys), 1);
  assert.equal(moduleOrdinal("lets_read", knowledgeKeys), 2);
  assert.equal(moduleOrdinal("lets_talk", knowledgeKeys), 3);
  // 不参与编号的模块不在列表里，返回 null（学习目标、主题页）
  assert.equal(moduleOrdinal("learning_objectives", knowledgeKeys), null);
  assert.equal(moduleOrdinal(undefined, knowledgeKeys), null);

  // 学生用书复习课没有 explore/read，编号整体前移
  const revisionKeys = ["lets_say", "lets_talk", "lets_use"];
  assert.equal(moduleOrdinal("lets_say", revisionKeys), 1);
  assert.equal(moduleOrdinal("lets_use", revisionKeys), 3);
  assert.equal(moduleOrdinal("lets_explore", revisionKeys), null);

  assert.equal(ordinalPrefix(null), "");
  assert.equal(ordinalPrefix(2), "2. ");
}

function testNormalizeModuleHeading() {
  // 模型写成什么标题都要被换成统一的「序号. 模块名」，并且升为一级标题
  assert.equal(
    normalizeModuleHeading("## Let's talk!\n\n### The passive\n\n正文", "3. Let's talk!"),
    "# 3. Let's talk!\n\n### The passive\n\n正文",
  );
  // 带上模块全名的标题（`Let's talk! · 语法`）同样替换掉，正文里不会再冒出一个同名标题
  assert.equal(
    normalizeModuleHeading("## Let's talk! · 语法\n\n### The passive", "3. Let's talk!"),
    "# 3. Let's talk!\n\n### The passive",
  );
  // 重复规范化结果不变
  const once = normalizeModuleHeading("## Let's say!\n\n### 核心词汇", "1. Let's say!");
  assert.equal(normalizeModuleHeading(once, "1. Let's say!"), once);
  // 不编号的模块（学习目标）去掉标题行：标题并进表格首行
  assert.equal(
    normalizeModuleHeading(OBJECTIVES_MARKDOWN, null),
    "| | |\n| --- | --- |\n| 目标词汇 | admission, assignment, bright |\n| 核心语法 | Future Forms: Review & Extension |",
  );
  // 首行不是标题时补一行标题
  assert.equal(normalizeModuleHeading("正文", "2. Let's read!"), "# 2. Let's read!\n\n正文");
  // 空文本不出错
  assert.equal(normalizeModuleHeading("", "1. Let's say!"), "");

  // 模型直接从第一个小节写起时，**不能把小节标题吃掉**——插入模块标题即可。
  // 练习册的模块标题是 `Day 1`，而正文第一个标题是板块 `## Let's say!`；
  // 知识清单同理，模型可能省略 `## Let's say!` 直接写 `### 核心词汇`。
  assert.equal(
    normalizeModuleHeading("## Let's say!\n\n正文", "Day 1"),
    "# Day 1\n\n## Let's say!\n\n正文",
  );
  assert.equal(
    normalizeModuleHeading("### 核心词汇\n\n正文", "1. Let's say!"),
    "# 1. Let's say!\n\n### 核心词汇\n\n正文",
  );
  // 模型自己写了模块标题（带或不带序号）时仍然替换，不留重复标题
  assert.equal(
    normalizeModuleHeading("# Day 1\n\n## Let's say!", "Day 1"),
    "# Day 1\n\n## Let's say!",
  );
  assert.equal(
    normalizeModuleHeading("## 3. Let's talk!\n\n正文", "3. Let's talk!"),
    "# 3. Let's talk!\n\n正文",
  );
  // 富文本编辑区回写时 turndown 会把序号里的点转义成 `1\.`，
  // 认不出它就会**每编辑一次多插一行模块标题**（回归）。
  assert.equal(
    normalizeModuleHeading("# 1\\. Let's say!\n\n### 核心词汇", "1. Let's say!"),
    "# 1. Let's say!\n\n### 核心词汇",
  );
}

function testResolveTemplates() {
  const knowledge = (moduleKey) => ({ bookType: "knowledge", moduleKey });
  // 词卡与派生词表同模块同列数，只能靠表头字段区分。
  assert.equal(resolveTableTemplate(knowledge("lets_say"), ["难度", "词汇", "音标", "词性和含义"]), "word-card");
  assert.equal(resolveTableTemplate(knowledge("lets_say"), ["名词", "动词", "形容词", "副词"]), "derived");
  assert.equal(resolveTableTemplate(knowledge("learning_objectives"), ["", ""]), "objectives");
  // 空表头**只有**学习目标表算数：旧版网格题转成 Markdown 后也是空表头，
  // 认成学习目标表会把首行换成模块标题、第一列压成 92px 蓝色（回归）。
  assert.equal(resolveTableTemplate({ bookType: "workbook", moduleKey: "day_1" }, ["", "", "", ""]), "generic");
  assert.equal(resolveTableTemplate({ bookType: "student", moduleKey: "lets_say" }, ["", ""]), "generic");
  assert.equal(resolveTableTemplate(knowledge("lets_read"), ["词汇", "原句"]), "term-example");
  assert.equal(resolveTableTemplate(knowledge("lets_read"), ["题目中的核心词", "文章中的相似表达", "替换技巧"]), "reading-skill");
  assert.equal(resolveTableTemplate(knowledge("lets_talk"), ["时态/结构", "用法", "例句"]), "grammar");
  assert.equal(resolveTableTemplate({}, ["任意", "表", "头"]), "generic");
}

function testParseBlocks() {
  const blocks = parseMarkdownBlocks(
    ["# 标题", "", "普通段落。", "", "- 项目一", "- 项目二", "", "1. 第一条", "", DERIVED_MARKDOWN].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "list", "list", "table"],
  );
  const table = blocks.at(-1);
  assert.deepEqual(table.header, ["名词", "动词", "形容词", "副词"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], ["admission", "admit", "admissible", "/"]);
}

function testParseWordCardTableKeepsBlankTailCells() {
  const table = parseMarkdownBlocks(CARD_MARKDOWN).find((block) => block.kind === "table");
  assert.deepEqual(table.header, ["难度", "词汇", "音标", "词性和含义"]);
  // 字段行必须保留四个单元格，尾部两个是空串——合并逻辑靠这个判断。
  assert.deepEqual(table.rows[1], ["释义", "permission to enter a place", "", ""]);
}

function testParseEmptyHeaderRow() {
  const table = parseMarkdownBlocks("| | |\n| --- | --- |\n| 目标词汇 | admission |")
    .find((block) => block.kind === "table");
  assert.deepEqual(table.header, ["", ""]);
}

function testStrayDelimiterDoesNotLoop() {
  // 孤立的分隔行不是表格，也不能让解析器卡死。
  const blocks = parseMarkdownBlocks("| --- |\n\n正文");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "paragraph"]);
}

function testParseInlineBold() {
  assert.deepEqual(parseInline("释义：**permission** to enter"), [
    { text: "释义：", bold: false },
    { text: "permission", bold: true },
    { text: " to enter", bold: false },
  ]);
  assert.deepEqual(parseInline("没有标记"), [{ text: "没有标记", bold: false }]);
}

async function testDocxPageSetupMatchesSample() {
  const buffer = await buildDocx({ title: "T", blocks: [exportBlock({ moduleKey: "lets_say", markdown: CARD_MARKDOWN })] });
  const doc = readZipEntry(buffer, "word/document.xml");
  // A4 + 成稿页边距
  assert.match(doc, /<w:pgSz w:w="11900" w:h="16840"/);
  assert.match(doc, /<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/);
  const styles = readZipEntry(buffer, "word/styles.xml");
  // 正文 11pt，字体与成稿一致
  assert.match(styles, /w:ascii="Arial Unicode MS"/);
  assert.match(styles, /w:eastAsia="Microsoft YaHei"/);
  assert.match(styles, /<w:sz w:val="22"\/>/);
}

async function testDocxMergesWordCardFieldRows() {
  const [table] = await tablesOfModule("lets_say", CARD_MARKDOWN);
  const rows = rowsOf(table);
  // 表头、取值行各 4 个单元格；释义/例句两行合并成整行。
  assert.equal(cellsOf(rows[0]).length, 4);
  assert.equal(cellsOf(rows[1]).length, 4);
  assert.equal(cellsOf(rows[2]).length, 1);
  assert.equal(cellsOf(rows[3]).length, 1);
  assert.equal((table.match(/w:gridSpan w:val="4"/g) ?? []).length, 2);
  assert.match(rows[2], /释义：permission to enter a place/);
  // 词卡表头不加底色（成稿里就是无底色）
  assert.doesNotMatch(rows[0], /<w:shd/);
  // 音标列在成稿里是 12pt 深灰
  assert.match(rows[1], /<w:sz w:val="24"\/>/);
  assert.match(rows[1], /<w:color w:val="333333"\/>/);
}

async function testDocxDerivedTableCentered() {
  const [table] = await tablesOfModule("lets_say", DERIVED_MARKDOWN);
  const rows = rowsOf(table);
  assert.match(rows[0], /w:fill="f5f6fb"/);
  assert.match(rows[0], /<w:b\/>/);
  assert.match(rows[0], /<w:jc w:val="center"\/>/);
  // 派生词表不能合并，且数据行居中、垂直居中
  assert.doesNotMatch(table, /w:gridSpan/);
  assert.match(rows[1], /<w:jc w:val="center"\/>/);
  assert.match(rows[1], /<w:vAlign w:val="center"\/>/);
}

async function testDocxTermExampleCollapsesToOneColumn() {
  const [table] = await tablesOfModule("lets_read", TERM_EXAMPLE_MARKDOWN);
  const rows = rowsOf(table);
  // 成稿的阅读词汇没有表头行，每一行是「词条加粗 + 例句灰色」一格两段
  assert.equal(rows.length, 1);
  assert.equal(cellsOf(rows[0]).length, 1);
  assert.equal((rows[0].match(/<w:p[ >]/g) ?? []).length, 2);
  assert.match(rows[0], /geology n. 地质学/);
  assert.match(rows[0], /<w:b\/>/);
  assert.match(rows[0], /<w:color w:val="494949"\/>/);
  assert.doesNotMatch(table, /w:gridSpan/);
}

async function testDocxReadingSkillHeaderUsesEfefefLeft() {
  const [table] = await tablesOfModule("lets_read", READING_SKILL_MARKDOWN);
  const rows = rowsOf(table);
  assert.match(rows[0], /w:fill="efefef"/);
  assert.match(rows[0], /<w:b\/>/);
  // 成稿里阅读技能表头是左对齐
  assert.doesNotMatch(rows[0], /<w:jc w:val="center"\/>/);
}

async function testDocxGrammarBoldsStructureColumn() {
  const [table] = await tablesOfModule("lets_talk", GRAMMAR_MARKDOWN);
  const rows = rowsOf(table);
  assert.match(rows[0], /w:fill="f5f6fb"/);
  const first = cellsOf(rows[1])[0];
  const rest = cellsOf(rows[1])[1];
  // 结构列加粗并垂直居中，用法/例句列保持正文样式
  assert.match(first, /<w:b\/>/);
  assert.match(first, /<w:vAlign w:val="center"\/>/);
  assert.doesNotMatch(rest, /<w:b\/>/);
}

async function testDocxFoldsObjectivesTitleIntoTable() {
  const [table] = await tablesOfModule("learning_objectives", OBJECTIVES_MARKDOWN);
  const rows = rowsOf(table);
  // 标题并进表格首行（跨两列居中、Arial 16pt），不再单独出一段标题
  assert.equal(rows.length, 3);
  assert.match(rows[0], /w:gridSpan w:val="2"/);
  assert.match(rows[0], /<w:jc w:val="center"\/>/);
  assert.match(rows[0], /w:ascii="Arial"/);
  assert.match(rows[0], /<w:sz w:val="32"\/>/);
  assert.equal(textOfCell(cellsOf(rows[0])[0]), "学习目标");
  // 字段名 Arial 14pt 蓝色，取值列正文样式
  assert.match(rows[1], /<w:color w:val="0070C0"\/>/);
  assert.match(rows[1], /<w:sz w:val="28"\/>/);
  assert.doesNotMatch(rows[0], /<w:shd/);
}

async function testDocxColumnWidthsFillTextColumn() {
  for (const [moduleKey, markdown] of [
    ["lets_say", CARD_MARKDOWN],
    ["lets_say", DERIVED_MARKDOWN],
    ["lets_read", READING_SKILL_MARKDOWN],
    ["lets_talk", GRAMMAR_MARKDOWN],
  ]) {
    const [table] = await tablesOfModule(moduleKey, markdown);
    const widths = gridWidthsOf(table);
    // 各板块列宽都必须合计等于版心 8300，否则固定列宽表格会溢出或留空
    assert.equal(widths.reduce((a, b) => a + b, 0), 8300, `${moduleKey} 列宽合计不对`);
  }
}

/** 取出正文里带 Word 标题样式的段落，按出现顺序返回「样式 + 字号 + 文字」。 */
function headingsOf(doc) {
  return [...doc.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)]
    .map((match) => match[0])
    .map((p) => {
      const style = /<w:pStyle w:val="([^"]+)"\/>/.exec(p)?.[1];
      if (!style || !/Heading/i.test(style)) return null;
      const text = [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
      return {
        style,
        size: Number(/<w:sz w:val="(\d+)"\/>/.exec(p)?.[1] ?? 0),
        text: text.replace(/&apos;/g, "'"),
      };
    })
    .filter(Boolean);
}

async function testDocxHeadingOutline() {
  const buffer = await buildDocx({
    title: "Lesson 9 The next step",
    blocks: [
      exportBlock({ moduleKey: "learning_objectives", markdown: OBJECTIVES_MARKDOWN }),
      exportBlock({ moduleKey: "lets_say", markdown: LETS_SAY_MARKDOWN }),
      exportBlock({ moduleKey: "lets_read", markdown: LETS_READ_MARKDOWN }),
      exportBlock({ moduleKey: "lets_talk", markdown: LETS_TALK_MARKDOWN }),
    ],
  });
  const headings = headingsOf(readZipEntry(buffer, "word/document.xml"));

  // 带编号的模块标题是标题 1（16pt），下设小节是标题 2（14pt）
  assert.deepEqual(
    headings.map((h) => `${h.style} ${h.text}`),
    [
      "Heading1 Lesson 9 The next step",
      "Heading1 1. Let's say!",
      "Heading2 核心词汇",
      "Heading2 FCE 重难点派生词表",
      "Heading1 2. Let's read!",
      "Heading2 阅读词汇",
      "Heading2 阅读技能",
      "Heading1 3. Let's talk!",
      "Heading2 情态动词表推测与推断",
    ],
  );
  assert.equal(headings[1].size, 32);
  assert.equal(headings[2].size, 28);
  // 「学习目标」不进大纲：它的标题是表格首行，不是标题段
  assert.equal(headings.some((h) => h.text === "学习目标"), false);
}

async function testDocxRepairsDamagedWordCardRow() {
  // 早期往返损坏过的写法：取值被并回第一列，导出时仍要合并成整行
  const damaged = [
    "## Let's say!", "",
    "| 难度 | 词汇 | 音标 | 词性和含义 |", "| --- | --- | --- | --- |",
    "| C1 | pointless | /ˈpɔɪntləs/ | adj. 无意义的 |",
    "| 释义：having no purpose | | | |",
  ].join("\n");
  const [table] = await tablesOfModule("lets_say", damaged);
  const rows = rowsOf(table);
  assert.equal(cellsOf(rows[2]).length, 1);
  assert.match(rows[2], /w:gridSpan w:val="4"/);
  assert.match(rows[2], /释义：having no purpose/);
}

/**
 * 学生用书的导出。
 *
 * 与知识清单同名的模块（lets_say）必须产出完全不同的结构与编号，
 * 这是 (书种, 模块) 索引在导出侧生效的判据。
 */
async function testDocxStudentBookModule() {
  const studentSay = [
    "## Let's say!",
    "",
    "### 2a",
    "",
    "Read the text and guess the meaning of the words in bold.",
    "",
    "| Word | Meaning |",
    "| --- | --- |",
    "| charm | a pleasing quality |",
  ].join("\n");
  const buffer = await buildDocx({
    title: "Lesson 9",
    blocks: [
      exportBlock({
        moduleKey: "lets_say",
        bookType: "student",
        markdown: studentSay,
      }),
    ],
  });
  const doc = readZipEntry(buffer, "word/document.xml");
  const headings = headingsOf(doc);
  // 常规课里 lets_say 是第 2 个模块（explore 占 1）
  assert.equal(headings[1].text, "2. Let's say!");
  assert.equal(headings[1].style, "Heading1");
  // 学生用书的表头不是词卡字段，落到通用表格：不加底色的普通表头
  const table = [...doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)][0][0];
  assert.doesNotMatch(table, /w:gridSpan/);
}

/** 学生用书主题页：不编号，但标题要保留（不能像知识清单「学习目标」那样并进表格）。 */
async function testDocxStudentObjectivesKeepsHeading() {
  const markdown = [
    "## In this lesson, we will...",
    "",
    "- learn words for talking about memories",
    "- read the article “Fond memories”",
    "- learn the grammar of question tags",
  ].join("\n");
  const buffer = await buildDocx({
    title: "Lesson 9",
    blocks: [exportBlock({ moduleKey: "learning_objectives", bookType: "student", markdown })],
  });
  const headings = headingsOf(readZipEntry(buffer, "word/document.xml"));
  assert.equal(headings[1].text, "In this lesson, we will...");
  // 不编号：没有「1.」前缀
  assert.doesNotMatch(headings[1].text, /^\d+\./);
  // 也没有表格首行标题那一套
  assert.doesNotMatch(readZipEntry(buffer, "word/document.xml"), /data-table-title|学习目标/);
}

/**
 * 练习册的导出：三层标题（Day → Let's xxx! → 大题），且编号不带「1.」前缀。
 *
 * 练习册的模块标题是 `Day 1` 而不是 `1. Let's say!`——Day 本身就是编号。
 * 同时它比另外两书多一层：板块（`## Let's say!`）下面还有大题（`### 1 Match...`）。
 */
async function testDocxWorkbookThreeLevelHeadings() {
  const markdown = [
    "## Let's say!",
    "",
    "### 1 Match the words with their meanings.",
    "",
    "1 overcome",
    "2 relief",
    "",
    "## Let's talk!",
    "",
    "### 2 Choose the correct answer.",
    "",
    "1 He is afraid ___ spiders.",
  ].join("\n");
  const buffer = await buildDocx({
    title: "Lesson 13",
    blocks: [exportBlock({ moduleKey: "day_1", bookType: "workbook", markdown })],
  });
  const headings = headingsOf(readZipEntry(buffer, "word/document.xml"));

  assert.deepEqual(
    headings.map((h) => `${h.style} ${h.text}`),
    [
      "Heading1 Lesson 13",
      // Day 是模块标题：16pt、不加编号前缀
      "Heading1 Day 1",
      "Heading2 Let's say!",
      "Heading3 1 Match the words with their meanings.",
      "Heading2 Let's talk!",
      "Heading3 2 Choose the correct answer.",
    ],
  );
  assert.equal(headings[1].size, 32, "Day 标题 16pt");
  assert.equal(headings[2].size, 28, "板块 14pt");
  assert.equal(headings[3].size, 26, "大题 13pt");
  assert.doesNotMatch(headings[1].text, /^\d+\./, "练习册不加「1.」前缀");
}

/** 小节标题的深度要按相对层级压平，否则同一本书里大小会不一致。 */
function testNormalizeHeadingDepths() {
  // 知识清单：模型写 ### 小节，应压成 ##
  assert.equal(
    normalizeHeadingDepths("# 1. Let's say!\n\n### 核心词汇\n\n正文\n\n#### 子项"),
    "# 1. Let's say!\n\n## 核心词汇\n\n正文\n\n### 子项",
  );
  // 练习册：## 板块 已经是二级，保持不动
  assert.equal(
    normalizeHeadingDepths("# Day 1\n\n## Let's say!\n\n### 1 Match"),
    "# Day 1\n\n## Let's say!\n\n### 1 Match",
  );
  // 只有模块标题时不动
  assert.equal(normalizeHeadingDepths("# Day 1\n\n正文"), "# Day 1\n\n正文");
  // 没有标题也不出错
  assert.equal(normalizeHeadingDepths("只有正文"), "只有正文");
}

async function testDocxIncludesEveryBlock() {
  const buffer = await buildDocx({
    title: "Lesson 9 The next step",
    blocks: [
      exportBlock({ moduleKey: "learning_objectives", markdown: OBJECTIVES_MARKDOWN }),
      exportBlock({ moduleKey: "lets_say", markdown: CARD_MARKDOWN }),
    ],
  });
  assert.equal(buffer.subarray(0, 2).toString("utf8"), "PK");
  const doc = readZipEntry(buffer, "word/document.xml");
  assert.match(doc, /Lesson 9 The next step/);
  assert.match(doc, /学习目标/);
  assert.match(doc, /核心词汇/);
  assert.match(doc, /admission/);
}

const tests = [
  ["词卡表头识别", testWordCardHeaderMatches],
  ["派生词表不是词卡", testDerivedTableIsNotWordCard],
  ["词卡字段行判定与拆解", testWordCardFieldRowDetection],
  ["模块编号", testModuleOrdinals],
  ["模块标题规范化", testNormalizeModuleHeading],
  ["板块模板判定", testResolveTemplates],
  ["块级解析：标题/段落/列表/表格", testParseBlocks],
  ["词卡表格保留尾部空单元格", testParseWordCardTableKeepsBlankTailCells],
  ["空表头行解析", testParseEmptyHeaderRow],
  ["孤立分隔行不会死循环", testStrayDelimiterDoesNotLoop],
  ["行内加粗拆分", testParseInlineBold],
  ["DOCX 页面与正文字体同成稿", testDocxPageSetupMatchesSample],
  ["DOCX 词卡字段行合并成整行", testDocxMergesWordCardFieldRows],
  ["DOCX 派生词表数据居中", testDocxDerivedTableCentered],
  ["DOCX 阅读词汇合成一列", testDocxTermExampleCollapsesToOneColumn],
  ["DOCX 阅读技能表头 efefef 左对齐", testDocxReadingSkillHeaderUsesEfefefLeft],
  ["DOCX 语法表结构列加粗", testDocxGrammarBoldsStructureColumn],
  ["DOCX 学习目标标题并进表格首行", testDocxFoldsObjectivesTitleIntoTable],
  ["DOCX 标题层级与编号", testDocxHeadingOutline],
  ["DOCX 修复往返损坏的词卡字段行", testDocxRepairsDamagedWordCardRow],
  ["DOCX 列宽合计等于版心", testDocxColumnWidthsFillTextColumn],
  ["DOCX 学生用书同名模块产出不同结构", testDocxStudentBookModule],
  ["DOCX 学生用书主题页保留标题", testDocxStudentObjectivesKeepsHeading],
  ["DOCX 练习册三层标题", testDocxWorkbookThreeLevelHeadings],
  ["小节标题按相对层级压平", testNormalizeHeadingDepths],
  ["DOCX 包含全部模块", testDocxIncludesEveryBlock],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`导出测试通过:${tests.length} 项`);
