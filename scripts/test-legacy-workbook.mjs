import assert from "node:assert/strict";
import {
  splitLegacyWorkbookMarkdown,
  workbookSectionKey,
} from "../lib/knowledge/legacy-workbook.ts";
import { splitLegacyMarkdown } from "../lib/knowledge/legacy-source.ts";
import { buildPagedMarkdown } from "../lib/knowledge/ocr-pages.ts";

/**
 * 夹具照**实测的旧版练习册**结构：栏目与学生用书同源（`Hello X`），
 * 课边界是页眉重建出来的 `# Unit N`。
 * 含已知 OCR 噪声：吞掉首字母的 `ello Vocabulary` / `ello Writing`。
 */
const MARKDOWN = `<!-- page 0 -->
# Unit 1

## Hello Vocabulary

1a Choose the correct letters to complete the words.

## Hello Grammar

2a Match the question halves.

## Hello Reading

a Read about four teenagers' experiences.

## Hello Use of English

A one-house town

## Hello Revision

5a Complete the questions with a word from the box.

<!-- page 8 -->
# Unit 2

## Hello Vocabulary

1a Choose the correct missing letters.

## Hello Grammar

2b Complete the sentences using the correct pronoun.

## Hello Listening

3a You will hear five short extracts.

## ello Writing

a Read the writing task below.

## Hello Revision

5a Read the clues and do the crossword.
`;

function testSectionKeyMapping() {
  // 与学生用书共用 `Hello X` 映射
  assert.equal(workbookSectionKey("Hello Vocabulary"), "say");
  assert.equal(workbookSectionKey("Hello Grammar"), "talk");
  assert.equal(workbookSectionKey("Hello Reading"), "read");
  assert.equal(workbookSectionKey("Hello Listening"), "use");
  assert.equal(workbookSectionKey("Hello Writing"), "use");
  assert.equal(workbookSectionKey("Hello Use of English"), "use");
  // 练习册特有：复习单元
  assert.equal(workbookSectionKey("Hello Revision"), "revision");
  // 容忍 OCR 吞掉首字母 H（实测 `ello Vocabulary` / `ello Writing`）
  assert.equal(workbookSectionKey("ello Vocabulary"), "say");
  assert.equal(workbookSectionKey("ello Writing"), "use");
  assert.equal(workbookSectionKey("随便什么"), "other");
}

function testUnitBoundariesAndSections() {
  const packages = splitLegacyWorkbookMarkdown(MARKDOWN);
  assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [1, 2]);

  const unit1 = packages[0];
  assert.deepEqual(
    unit1.candidates.map((item) => item.sectionKey),
    ["say", "talk", "read", "use", "revision"],
  );
  // 每单元末尾的 `Hello Revision` 归 `revision`。它**不是**只作来源——复习课（第 7 课）
  // 正需要它；常规课的模块都不取这个键（day_1 取 say+talk、day_4 取 read、day_5 取 use），
  // 所以它不会混进常规课的正文。这条由模块目录保证，见 test-module-directory.mjs。
  assert.equal(unit1.candidates.every((item) => !item.sourceOnly), true);

  // 单元 2 有 Listening/Writing（旧版按单元不同），都归到 use
  const unit2 = packages[1];
  const unit2Keys = unit2.candidates.map((item) => item.sectionKey);
  assert.deepEqual(unit2Keys, ["say", "talk", "use", "use", "revision"]);
}

/**
 * 回归：复习单元（`# Unit 7`）的编号题要切成来源块。
 *
 * 它是**整课复习**，用带圈数字编号、没有 `Hello X` 栏目名——按栏目名判定时整讲
 * 一个来源块都切不出来，复习课因此报「没有可生成的内容（仅保留来源侧）」。
 */
function testRevisionUnitNumberedExercises() {
  const markdown = [
    "# Unit 7",
    "",
    "## ① All the words have the /i:/ sound. Write ee ea, i, ei or ie to complete the words.",
    "",
    "1 cl_ ea _n: not dirty",
    "",
    "## ② Choose the best option (A, B or C) to complete the sentences.",
    "",
    "1 You can always rely ___ Jack. A in B on C about",
    "",
    "## ③Complete with the question tags.",
    "",
    "1 I'm the oldest person here, aren't I?",
    "",
    "## ④ Read the writing task below and tick the two things you must include in your article.",
    "",
    "## ⑤Write your article in 140–190 words in an appropriate style.",
    "",
    "## Word List",
    "",
    "Unit 1 Fond memories",
    "commute V.",
  ].join("\n");

  const unit7 = splitLegacyWorkbookMarkdown(markdown)[0];
  assert.equal(unit7.sourceLessonNumber, 7);
  assert.deepEqual(
    unit7.candidates.map((item) => item.sectionKey),
    ["revision", "revision", "revision", "revision", "revision"],
  );
  // 五道编号题各自成块，题面进 sectionLabel
  assert.match(unit7.candidates[0].sectionLabel, /^① All the words have the \/i:\/ sound/);
  assert.match(unit7.candidates[2].sectionLabel, /^③Complete with the question tags/);
  assert.match(unit7.candidates[0].rawText, /not dirty/);
  assert.match(unit7.candidates[4].rawText, /Write your article in 140–190 words/);
  // 书末词表是书级附录，不能跟着最后一道题进来源
  assert.doesNotMatch(unit7.candidates[4].rawText, /commute/);
  assert.equal(unit7.candidates.every((item) => !item.sourceOnly), true, "复习课的题源要可用");
}

/**
 * 回归：常规单元里的 `## ①a …` **不是**栏目边界。
 *
 * 它是 `Hello Vocabulary` 内部的小题号。判据因此不是"标题长什么样"，
 * 而是"这一讲有没有 `Hello X` 栏目"——常规单元有，复习单元没有。
 * 认错了会把整个词汇栏目切断。
 */
function testNumberedExerciseInsideRegularUnitIsNotCut() {
  const markdown = [
    "# Unit 1",
    "",
    "## Hello Vocabulary",
    "",
    "## ①a Choose the correct letters to complete the words.",
    "",
    "1 res_ist",
    "",
    "## b Use the correct form of a word from 1a to complete the sentences.",
    "",
    "## Hello Grammar",
    "",
    "2a Match the question halves.",
  ].join("\n");

  const unit1 = splitLegacyWorkbookMarkdown(markdown)[0];
  assert.deepEqual(
    unit1.candidates.map((item) => item.sectionKey),
    ["say", "talk"],
    "常规单元只该有 say / talk 两个栏目",
  );
  const say = unit1.candidates[0];
  assert.match(say.rawText, /①a Choose the correct letters/, "小题号留在词汇栏目正文里");
  assert.match(say.rawText, /1 res_ist/);
  assert.match(say.rawText, /Use the correct form of a word from 1a/);
}

/** 二级标题里的 Unit 字样不能被当成课边界。 */
function testSubHeadingIsNotLessonBoundary() {
  const packages = splitLegacyWorkbookMarkdown(
    ["# Unit 1", "", "## Hello Vocabulary", "", "## Unit 7 Revision unt / Revision"].join("\n"),
  );
  assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [1], "只有一级标题才是课边界");
}

function testDispatcherRoutesWorkbook() {
  assert.deepEqual(
    splitLegacyMarkdown(MARKDOWN, "workbook").map((item) => item.sourceLessonNumber),
    [1, 2],
  );
  // 练习册的课边界是 `Unit N`；知识清单认的是 `第N讲`，切不出东西
  assert.deepEqual(splitLegacyMarkdown(MARKDOWN, "knowledge"), []);
  // 未知书种返回空，不回退到别的解析器
  assert.deepEqual(splitLegacyMarkdown(MARKDOWN, "vocab"), []);
}

// ---------------------------------------------------------------------------
// 页码/课号重建
// ---------------------------------------------------------------------------

/** 造一个 content_list：页脚带课号，正文块带页码。 */
function blocks() {
  return [
    { type: "text", page_idx: 0, text: "Hello Vocabulary", text_level: 2 },
    { type: "text", page_idx: 0, text: "1a Choose the correct letters." },
    { type: "footer", page_idx: 0, text: "Unit 1" },
    // 第二页页脚仍然写 Unit 1，不应重复输出课标题
    { type: "text", page_idx: 1, text: "Hello Grammar", text_level: 2 },
    { type: "footer", page_idx: 1, text: "Unit 1" },
    // 第三页换课：**页脚在页尾**，但课标题必须出现在这一页的开头
    { type: "text", page_idx: 2, text: "Hello Vocabulary", text_level: 2 },
    { type: "footer", page_idx: 2, text: "2.Unit 2" },
  ];
}

function testPagedMarkdownPutsLessonMarkerAtPageStart() {
  const md = buildPagedMarkdown(blocks());
  const lines = md.split("\n").filter(Boolean);
  // 课标题出现在该页内容之前——页脚上的课号指的是本页，不是上一页
  const unit2Index = lines.indexOf("# Unit 2");
  const page2Index = lines.indexOf("<!-- page 2 -->");
  const vocabAfter = lines.findIndex((line, i) => i > unit2Index && line.includes("Hello Vocabulary"));
  assert.ok(page2Index >= 0 && unit2Index === page2Index + 1, "课标题紧跟在换页标记之后");
  assert.ok(vocabAfter > unit2Index, "本页内容在课标题之后");
  // 同一课不重复输出
  assert.equal(lines.filter((line) => line === "# Unit 1").length, 1);
  // 页眉页脚不进正文
  assert.doesNotMatch(md, /Unit 1\n\n# Unit 1/);
}

function testPagedMarkdownKeepsPageMarkersAndImages() {
  const md = buildPagedMarkdown([
    { type: "image", page_idx: 0, img_path: "images/a.jpg" },
    { type: "table", page_idx: 0, table_body: "<table><tr><td>x</td></tr></table>" },
    { type: "page_number", page_idx: 0, text: "11" },
  ]);
  assert.match(md, /<!-- page 0 -->/);
  assert.match(md, /<!-- image: images\/a\.jpg -->/);
  assert.match(md, /<table>/);
  assert.doesNotMatch(md, /11/, "页码块不进正文");
}

const tests = [
  ["练习册栏目映射（与学生用书同源 + 复习单元）", testSectionKeyMapping],
  ["Unit 边界与栏目切分", testUnitBoundariesAndSections],
  ["复习单元的编号题切成来源块（回归）", testRevisionUnitNumberedExercises],
  ["常规单元里的小题号不是栏目边界（回归）", testNumberedExerciseInsideRegularUnitIsNotCut],
  ["二级标题里的 Unit 不是课边界", testSubHeadingIsNotLessonBoundary],
  ["按书种分派到练习册解析器", testDispatcherRoutesWorkbook],
  ["课标题插在换课那一页的开头", testPagedMarkdownPutsLessonMarkerAtPageStart],
  ["页码标记与图片 provenance 保留", testPagedMarkdownKeepsPageMarkersAndImages],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`练习册来源解析测试通过:${tests.length} 项`);
