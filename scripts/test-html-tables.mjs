import assert from "node:assert/strict";
import { htmlTablesToMarkdown } from "../lib/markdown/html-tables.ts";
import { buildKnowledgeContext } from "../lib/knowledge/context-builder.ts";

/**
 * 夹具照抄真实 OCR：练习册 Lesson 2 ①a「选正确字母补全单词」。
 * 这一条就是老师实际看到的乱码来源——14 行 4 列，全是 `<td>`。
 */
const WORKBOOK_GRID = [
  "## ①a Choose the correct missing letters to complete the words.",
  "",
  "<table><tr><td>1 res i s t</td><td>Aist</td><td>B est</td><td>C ust</td></tr>" +
    "<tr><td>2 p_. tless</td><td>A oin</td><td>B ain</td><td>C oim</td></tr>" +
    "<tr><td>3 p__. hase</td><td>A irc</td><td>B urc</td><td>C erc</td></tr></table>",
  "",
  "## ①b Complete the text…",
].join("\n");

/** 真实 OCR 的语法结构表：带 `rowspan`/`colspan`，还有 HTML 实体。 */
const GRAMMAR_TABLE =
  "<table><tr><td rowspan=2 colspan=1>Main sentence</td><td rowspan=1 colspan=2>Question tag</td></tr>" +
  "<tr><td rowspan=1 colspan=1>be / auxiliary verb / modal verb</td><td rowspan=1 colspan=1>subject</td></tr>" +
  "<tr><td rowspan=1 colspan=1>The lake is beautiful,</td><td rowspan=1 colspan=1>isn&#x27;t</td><td rowspan=1 colspan=1>it?</td></tr></table>";

/** 回归：老师看到的乱码就是这段 HTML 原样进了成稿。 */
function testWorkbookGridBecomesMarkdownTable() {
  const out = htmlTablesToMarkdown(WORKBOOK_GRID);
  assert.doesNotMatch(out, /<table|<tr|<td/, "不能残留任何 HTML 标签");
  const lines = out.split("\n").filter((line) => line.startsWith("|"));
  // 空表头 + 分隔行 + 3 行数据
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "| | | | |", "没有 <th> 时补空表头，不把第 1 题降格成表头");
  assert.equal(lines[1], "| --- | --- | --- | --- |");
  assert.equal(lines[2], "| 1 res i s t | Aist | B est | C ust |", "题目内容逐字保留");
  assert.equal(lines[4], "| 3 p__. hase | A irc | B urc | C erc |");
  // 题干与后面的栏目还在
  assert.match(out, /## ①a Choose the correct missing letters/);
  assert.match(out, /## ①b Complete the text/);
}

/** 合并单元格按单格输出；实体要解码。 */
function testMergedCellsAndEntities() {
  const out = htmlTablesToMarkdown(GRAMMAR_TABLE);
  assert.doesNotMatch(out, /<|&#/);
  const lines = out.split("\n").filter((line) => line.startsWith("|"));
  assert.equal(lines[0], "| | | |", "没有 <th>，补空表头");
  // 合并单元格不展开：`Main sentence`（跨 2 行）与 `Question tag`（跨 2 列）各占一格，
  // 于是这一行只有 2 格，按最宽的 3 列补齐。
  assert.equal(lines[2], "| Main sentence | Question tag | |");
  assert.equal(lines[3], "| be / auxiliary verb / modal verb | subject | |");
  assert.equal(lines[4], "| The lake is beautiful, | isn't | it? |");
  assert.match(out, /isn't/, "&#x27; 要解码成撇号");
}

/** 用了 `<th>` 的表头要保留成真表头。 */
function testRealHeaderIsKept() {
  const out = htmlTablesToMarkdown(
    "<table><tr><th>Vocab.</th><th>Part of Speech</th><th>Level</th></tr>" +
      "<tr><td>charm</td><td>n.</td><td>B2</td></tr></table>",
  );
  const lines = out.split("\n").filter((line) => line.startsWith("|"));
  assert.equal(lines[0], "| Vocab. | Part of Speech | Level |");
  assert.equal(lines[2], "| charm | n. | B2 |");
}

/** 列数不齐按最宽的行补齐，空单元格写 `| |`。 */
function testRaggedRowsArePadded() {
  const out = htmlTablesToMarkdown(
    "<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>",
  );
  const lines = out.split("\n").filter((line) => line.startsWith("|"));
  assert.equal(lines[3], "| d | | |");
}

/** 单元格内换行转成分号（Markdown 表格不能换行）。 */
function testLineBreakInsideCell() {
  const out = htmlTablesToMarkdown("<table><tr><td>a<br>b</td><td>c</td></tr></table>");
  assert.match(out, /\| a；b \| c \|/);
}

/** 单元格里的竖线要转义，否则会把表格撑破。 */
function testPipeInsideCellIsEscaped() {
  const out = htmlTablesToMarkdown("<table><tr><td>a|b</td><td>c</td></tr></table>");
  assert.match(out, /\| a\\\|b \| c \|/);
}

/** 没有表格的文本原样返回（这个函数在管线里多处调用）。 */
function testPlainTextUntouched() {
  const text = "## Let's say!\n\n| 难度 | 词汇 |\n| --- | --- |\n| B2 | charm |";
  assert.equal(htmlTablesToMarkdown(text), text);
}

/** 空表格不留残渣。 */
function testEmptyTableIsDropped() {
  assert.equal(htmlTablesToMarkdown("前\n\n<table></table>\n\n后"), "前\n\n后");
  assert.doesNotMatch(htmlTablesToMarkdown("<table><tr></tr></table>"), /<table/);
}

/**
 * 回归：**已经存进工作区**的来源条目也要在进 prompt 前转掉。
 *
 * 指纹里含内容，所以修好解析器之后重新导入会生成新条目，但**修复前保存的旧条目
 * 仍带 HTML**，重新生成时照旧会被检索出来——实测 lesson-02 的 `Day 1 · 人工来源`
 * 就是这样（3 个 HTML 表格）。所以进 prompt 的最后一刻必须再过一道。
 */
function testStoredSourceIsCleanedBeforePrompt() {
  const entry = {
    id: "e1",
    layer: "production_source",
    entry_type: "module_text",
    title: "Shopping around · Day 1 · 人工来源",
    content:
      "## ①a Choose the correct missing letters to complete the words.\n\n" +
      "<table><tr><td>1 res i s t</td><td>Aist</td><td>B est</td><td>C ust</td></tr></table>",
    source_ref: "manual:abc",
    source_module_id: null,
  };
  const context = buildKnowledgeContext({
    entries: [{ entry, sourceModule: null, reason: "exact_module", exactness: 1 }],
    trace: { selected: [] },
  });
  assert.doesNotMatch(context.sourceText, /<table|<td/, "进 prompt 的正文不能带 HTML 标签");
  assert.match(context.sourceText, /\| 1 res i s t \| Aist \| B est \| C ust \|/);
  assert.match(context.sourceText, /人工来源/, "来源标注要保留");
}

const tests = [
  ["练习册网格题转成 Markdown 表（回归）", testWorkbookGridBecomesMarkdownTable],
  ["工作区旧来源在进 prompt 前转掉（回归）", testStoredSourceIsCleanedBeforePrompt],
  ["合并单元格与 HTML 实体", testMergedCellsAndEntities],
  ["<th> 表头保留", testRealHeaderIsKept],
  ["列数不齐补齐", testRaggedRowsArePadded],
  ["单元格内换行转分号", testLineBreakInsideCell],
  ["单元格内竖线转义", testPipeInsideCellIsEscaped],
  ["无表格的文本原样返回", testPlainTextUntouched],
  ["空表格不留残渣", testEmptyTableIsDropped],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`HTML 表格转换测试通过:${tests.length} 项`);
