import assert from "node:assert/strict";
import {
  studentBookSectionKey,
  splitLegacyStudentBookMarkdown,
} from "../lib/knowledge/legacy-student-book.ts";
import { splitLegacyMarkdown } from "../lib/knowledge/legacy-source.ts";

/**
 * 夹具照抄真实 OCR 的写法，包含已知噪声：
 * `DIDYOU KNOW...?`（缺空格）、`LOOKE`（应为 LOOK!）、`4Read`（缺空格）、
 * 标题被 MinerU 挤到下一行、大小写不一。
 */
const MARKDOWN = `# HELLO ENGLISH

## Course 课程介绍 Introduction

前言不属于任何一课。

# UNIT1 Fond memories

## I can

use past simple; talk about memories

## DIDYOU KNOW...?

unit one lead-in

## Hello Vocabulary

unit one vocabulary

## Develop Your Vocabulary

words with multiple meanings

## Hello Reading

unit one reading

## Hello Grammar

question tags

## LOOKE

unit one grammar look box

## Hello Use of English

unit one use

# UNIT2

## Shopping around

## I can

unit two objectives

## Hello Vocabulary

unit two vocabulary

## Hello Listening

unit two listening

## Hello Grammar

unit two grammar

## Hello Speaking

unit two speaking

# 第3讲 知识清单

## 词汇复习

给旧版知识清单的写法留一条兼容路径

# UNIT7

## Vocabulary Revision

revision vocabulary

## Grammar Revision

revision grammar
`;

function testSectionKeyMapping() {
  // 噪声写法：缺空格、大小写、标点
  assert.equal(studentBookSectionKey("DIDYOU KNOW...?"), "explore");
  assert.equal(studentBookSectionKey("Did you know...?"), "explore");
  assert.equal(studentBookSectionKey("Hello World"), "explore");
  assert.equal(studentBookSectionKey("Hello World!"), "explore");

  assert.equal(studentBookSectionKey("I can"), "objectives");
  assert.equal(studentBookSectionKey("I CAN"), "objectives");

  assert.equal(studentBookSectionKey("Hello Vocabulary"), "say");
  assert.equal(studentBookSectionKey("Develop Your Vocabulary"), "say");
  assert.equal(studentBookSectionKey("Hello Reading"), "read");
  assert.equal(studentBookSectionKey("Hello Grammar"), "talk");

  // 复习单元的栏目复用常规键——复习课的模块就是 say/talk/use，
  // 靠复习单元的独立边界保证它们不会串进常规单元。
  assert.equal(studentBookSectionKey("Vocabulary Revision"), "say");
  assert.equal(studentBookSectionKey("Grammar Revision"), "talk");
  assert.equal(studentBookSectionKey("Reading Practice"), "read");
  assert.equal(studentBookSectionKey("Listening Practice"), "use");
  assert.equal(studentBookSectionKey("Speaking Practice"), "use");

  // 听力/口语/写作不再单设栏目，全部并入 Let's use!
  assert.equal(studentBookSectionKey("Hello Use of English"), "use");
  assert.equal(studentBookSectionKey("Hello Listening"), "use");
  assert.equal(studentBookSectionKey("Hello Speaking"), "use");
  assert.equal(studentBookSectionKey("Hello Writing"), "use");

  // Exam tip / Exam information 是栏目内的子块，**不是**顶级边界。
  // 把它们当成 use 的边界会切断 Hello Reading，使阅读模块拿不到课文。
  assert.equal(studentBookSectionKey("Exam tip"), "other");
  assert.equal(studentBookSectionKey("Exam information"), "other");

  // 认不出的标题不硬猜
  assert.equal(studentBookSectionKey("LOOKE"), "other");
  assert.equal(studentBookSectionKey("4Read and practise the examples"), "other");
}

function testLessonBoundaries() {
  const packages = splitLegacyStudentBookMarkdown(MARKDOWN);
  // UNIT1、UNIT2、第3讲、UNIT7 都要切出来
  assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [1, 2, 3, 7]);
}

function testSectionSplitting() {
  const packages = splitLegacyStudentBookMarkdown(MARKDOWN);
  const unit1 = packages.find((item) => item.sourceLessonNumber === 1);
  const keys = unit1.candidates.map((item) => item.sectionKey);
  assert.deepEqual(
    [...new Set(keys)],
    ["objectives", "explore", "say", "read", "talk", "use"],
  );
  // 栏目内部的子标题属于该栏目，必须一起取走
  const grammar = unit1.candidates.find((item) => item.sectionKey === "talk");
  assert.match(grammar.rawText, /question tags/);
  assert.match(grammar.rawText, /LOOKE/, "LOOK 提示框属于语法栏目的正文");
  // 一课的 say 可以有多块（Hello Vocabulary + Develop Your Vocabulary）
  assert.equal(unit1.candidates.filter((item) => item.sectionKey === "say").length, 2);
}

/**
 * 复习单元的栏目要能当来源用。
 *
 * 早先整讲只作来源（`DEFAULT_SOURCE_ONLY_UNITS = [7]`），复习课因此报
 * 「没有可生成内容（仅保留来源侧）」。现在复习课确定要生成，栏目归位到 say/talk，
 * 且不能被标成 sourceOnly。
 */
function testRevisionSectionsAreUsable() {
  const packages = splitLegacyStudentBookMarkdown(MARKDOWN);
  const unit7 = packages.find((item) => item.sourceLessonNumber === 7);
  assert.equal(unit7.candidates.length, 2);
  assert.deepEqual(
    unit7.candidates.map((item) => item.sectionKey),
    ["say", "talk"],
  );
  assert.equal(
    unit7.candidates.every((item) => !item.sourceOnly),
    true,
    "复习课的来源不能被标成只作来源",
  );
}

function testDispatcherPicksParserByBook() {
  // 学生用书走 UNIT + Hello X
  const student = splitLegacyMarkdown(MARKDOWN, "student");
  assert.deepEqual(student.map((item) => item.sourceLessonNumber), [1, 2, 3, 7]);
  // 知识清单走 第N讲 + 词汇复习；同一份文本里只有一条「第3讲」符合
  const knowledge = splitLegacyMarkdown(MARKDOWN, "knowledge");
  assert.deepEqual(knowledge.map((item) => item.sourceLessonNumber), [3]);
  assert.deepEqual(
    knowledge[0].candidates.map((item) => item.sectionKey),
    ["say"],
  );
}

/**
 * 回归：阅读栏目必须包含课文。
 *
 * 真实 OCR 里 `## Exam tip` 出现在 `## Hello Reading` 之后、课文之前。
 * 早先把 Exam tip 当顶级边界（映射到 use），Hello Reading 被切断，
 * read 只剩 240 字的导入语，**整篇课文落进了 use**。
 */
function testReadingSectionKeepsTheArticle() {
  const markdown = [
    "# UNIT1 Fond memories",
    "",
    "## Hello Reading",
    "",
    "3a You are going to read an article in which four teenagers talk about visiting a village.",
    "",
    "## Exam tip",
    "",
    "Read the short texts first, or read the questions one by one.",
    "",
    "## Which person says ...?",
    "",
    "# Beatful",
    "",
    "## A Sandy",
    "",
    "I live in a beautiful village.",
    "",
    "## B William",
    "",
    "My village is by the sea.",
    "",
    "## C Mary",
    "",
    "We grow our own food.",
    "",
    "## D Rob",
    "",
    "It is quiet in winter.",
    "",
    "## Complete the sentences with words from the text.",
    "",
    "## Hello Grammar",
    "",
    "## Question tags",
    "",
  ].join("\n");

  const packages = splitLegacyStudentBookMarkdown(markdown);
  const unit1 = packages.find((item) => item.sourceLessonNumber === 1);
  const read = unit1.candidates.find((item) => item.sectionKey === "read");
  assert.ok(read, "必须有 read 栏目");
  assert.match(read.rawText, /3a You are going to read/);
  assert.match(read.rawText, /# Beatful/, "课文标题必须在阅读栏目里");
  for (const person of ["A Sandy", "B William", "C Mary", "D Rob"]) {
    assert.match(read.rawText, new RegExp(person), `${person} 必须随课文一起取走`);
  }
  assert.match(read.rawText, /Complete the sentences/);

  // Exam tip 不能另起一个 use 边界
  assert.equal(
    unit1.candidates.some((item) => item.sectionLabel === "Exam tip"),
    false,
    "Exam tip 不该成为独立栏目",
  );
  // 后面的 Hello Grammar 仍然要正常成栏目
  assert.equal(unit1.candidates.some((item) => item.sectionKey === "talk"), true);
}

/**
 * 回归：栏目标题被排成一级标题时也要认。
 *
 * MinerU 对同一套栏目名给的层级并不稳定——真实 OCR 里学生用书 Unit 3 的
 * `Hello Use of English`、Unit 5 的 `Did you know...?` 与 `Hello Vocabulary`
 * 都是一级标题。只认 `##` 会让这些栏目整块消失。
 */
function testLevelOneSectionHeadings() {
  const markdown = [
    "# UNIT5 Stop Cyberbullying",
    "",
    "# Did you know...?",
    "",
    "unit five lead-in",
    "",
    "# Hello Vocabulary",
    "",
    "unit five vocabulary",
    "",
    "# Hello Use of English",
    "",
    "unit five use",
  ].join("\n");

  const unit5 = splitLegacyStudentBookMarkdown(markdown)[0];
  const keys = unit5.candidates.map((item) => item.sectionKey);
  assert.deepEqual(keys, ["explore", "say", "use"]);
  assert.match(unit5.candidates[0].rawText, /unit five lead-in/);
}

/**
 * 回归：标题前面多出噪声字符也要认。
 *
 * 真实 OCR 里学生用书 Unit 5 的 `Hello Use of English` 被读成
 * `I Hello Use of English`，整条 use 栏目因此消失。
 */
function testSectionHeadingWithPrefixNoise() {
  assert.equal(studentBookSectionKey("I Hello Use of English"), "use");
  assert.equal(studentBookSectionKey("Hello Use of English"), "use");
  // H 被吞掉的写法仍然要认（练习册实测）
  assert.equal(studentBookSectionKey("ello Vocabulary"), "say");
  assert.equal(studentBookSectionKey("Hello Vocabulary"), "say");
  // 不能放宽到"只要包含就算"
  assert.equal(studentBookSectionKey("Do you say hello to your neighbour"), "other");
}

/**
 * 回归：`Hello World` 标题整块丢失时，按单元结构补出 explore。
 *
 * 真实 OCR 里学生用书 Unit 2 的 `Hello World` 是一整幅跨页横幅，
 * MinerU 只切得出科普短文、切不出标题，短文于是落进了 `I can` 栏目，
 * `lets_explore` 取不到来源、生成直接报错（其余单元都有标题，所以只有部分课时出问题）。
 */
function testRecoversMissingExploreHeading() {
  const passage =
    "In most parts of the world, people shop at markets. People go to markets to find bargains, " +
    "buy fresh food or just look around. Markets are usually outdoors but there are also covered " +
    "markets, and what most markets have in common is that they're crowded and noisy.";
  const markdown = [
    "## UNIT2",
    "",
    "## I can",
    "",
    "-- use words related to shopping.",
    "",
    "-- use reflexive pronouns.",
    "",
    "![](images/shopping.jpg)",
    "",
    passage,
    "",
    "## Hello Vocabulary",
    "",
    "unit two vocabulary",
  ].join("\n");

  const unit2 = splitLegacyStudentBookMarkdown(markdown)[0];
  const explore = unit2.candidates.find((item) => item.sectionKey === "explore");
  assert.ok(explore, "explore 必须被补出来");
  assert.match(explore.rawText, /people shop at markets/);
  assert.equal(explore.sectionLabel, "Hello World");
  assert.equal(explore.sourceOnly, false, "补出来的栏目是正常可生成的来源");
  // 补出来的区间落在 I can 与 Hello Vocabulary 之间，不能和别的栏目重叠
  assert.deepEqual(
    unit2.candidates.map((item) => item.sectionKey),
    ["objectives", "explore", "say"],
  );
}

/** 补 explore 时，`I can` 的能力清单必须留在 objectives 里。 */
function testRecoveryKeepsObjectivesList() {
  const markdown = [
    "## UNIT2",
    "",
    "## I can",
    "",
    "-- use words related to shopping.",
    "",
    "-- use reflexive pronouns.",
    "",
    "A long lead-in passage that belongs to the explore section, long enough to be recovered. ".repeat(2),
    "",
    "## Hello Vocabulary",
    "",
    "unit two vocabulary",
  ].join("\n");

  const unit2 = splitLegacyStudentBookMarkdown(markdown)[0];
  const objectives = unit2.candidates.find((item) => item.sectionKey === "objectives");
  assert.match(objectives.rawText, /use words related to shopping/);
  assert.match(objectives.rawText, /use reflexive pronouns/);
  assert.doesNotMatch(objectives.rawText, /lead-in passage/, "话题引入不该留在 objectives 里");
}

/**
 * 回归：栏目内部的 `DID YOU KNOW?` 小标题不能当成话题引入。
 *
 * 真实 OCR 里学生用书 Unit 3 的 Hello Vocabulary 跨页是一整页杂志式词汇呈现，
 * 里面有个 `## DID YOU KNOW?` 小标题。照认的话 Hello Vocabulary 在那里被切断：
 * say 只剩 863 字，一整页词汇（4883 字）跑进了 explore。
 */
function testDidYouKnowInsideSpreadIsNotABoundary() {
  const markdown = [
    "## UNIT3",
    "",
    "## I can",
    "",
    "-- use the passive.",
    "",
    "## Did you know...?",
    "",
    "unit three lead-in about cows",
    "",
    "## Hello Vocabulary",
    "",
    "## IT'S HARD WORK",
    "",
    "## DID YOU KNOW?",
    "",
    "Wheat is farmed on every continent.",
    "",
    "## FUTURE CHALLENGES",
    "",
    "Farming needs to be in harmony with nature.",
    "",
    "## Hello Reading",
    "",
    "unit three reading",
  ].join("\n");

  const unit3 = splitLegacyStudentBookMarkdown(markdown)[0];
  assert.deepEqual(
    unit3.candidates.map((item) => item.sectionKey),
    ["objectives", "explore", "say", "read"],
  );
  const say = unit3.candidates.find((item) => item.sectionKey === "say");
  assert.match(say.rawText, /IT'S HARD WORK/);
  assert.match(say.rawText, /Wheat is farmed on every continent/, "跨页正文必须留在 say 里");
  assert.match(say.rawText, /FUTURE CHALLENGES/);
  const explore = unit3.candidates.find((item) => item.sectionKey === "explore");
  assert.doesNotMatch(explore.rawText, /Wheat is farmed/);
}

/**
 * 回归：复习单元要成为**独立的一讲**，它的内容不能混进上一个单元。
 *
 * 旧版学生用书目录页写的是 `Unit 7 Revision 112`，但正文里**没有 `UNIT 7` 标题**，
 * 复习单元从 `Vocabulary Revision` 直接开始。早先实测的后果：Unit 6 的 use 膨胀到
 * 26858 字（含 17912 字的 Speaking Practice），read 拿到复习单元的阅读文章——
 * 而部门大纲里 Lesson 5（原 Unit 6）的「阅读」本来就是空的。
 */
function testRevisionUnitIsItsOwnLesson() {
  const markdown = [
    "## UNIT6",
    "",
    "## Hello Listening",
    "",
    "unit six listening",
    "",
    "## Vocabulary Revision",
    "",
    "revision vocabulary",
    "",
    "## Grammar Revision",
    "",
    "revision grammar",
    "",
    "## Reading Practice",
    "",
    "revision reading",
    "",
    "## Listening Practice",
    "",
    "revision listening",
    "",
    "## Speaking Practice",
    "",
    "revision speaking",
  ].join("\n");

  const packages = splitLegacyStudentBookMarkdown(markdown);
  assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [6, 7], "复习单元要单独成讲");

  const unit6 = packages.find((item) => item.sourceLessonNumber === 6);
  assert.deepEqual(
    unit6.candidates.map((item) => item.sectionKey),
    ["use"],
    "第 6 讲只该有自己的听力栏目",
  );
  assert.doesNotMatch(unit6.candidates[0].rawText, /revision/, "复习内容不能越界到第 6 讲");

  const unit7 = packages.find((item) => item.sourceLessonNumber === 7);
  assert.deepEqual(
    unit7.candidates.map((item) => item.sectionKey),
    ["say", "talk", "read", "use", "use"],
    "复习单元的栏目按常规键归位，供复习课的 say/talk/use 取用",
  );
  assert.equal(
    unit7.candidates.every((item) => !item.sourceOnly),
    true,
    "复习课的来源不能被标成只作来源",
  );
  assert.equal(unit7.candidates[0].rawText.includes("revision vocabulary"), true);
}

/**
 * 书末 `Word List` 是书级附录，不能混进复习单元的最后一个栏目。
 *
 * MinerU 没给词表标题——正文里只有一行 `Unit 1 Fond memories Vocabulary` 加一张词表。
 * 不切掉的话，整本书的词表会跟着 `Speaking Practice` 一起进 `use`（实测几千字），
 * 复习课的 `Let's use!` 会拿它当来源。
 */
function testWordListIsNotLessonContent() {
  const markdown = [
    "## UNIT6",
    "",
    "## Hello Listening",
    "",
    "unit six listening",
    "",
    "## Vocabulary Revision",
    "",
    "revision vocabulary",
    "",
    "## Speaking Practice",
    "",
    "revision speaking",
    "",
    "Unit 1 Fond memories Vocabulary",
    "",
    "<table><tr><td>charm</td><td>n.</td><td>B2</td></tr></table>",
  ].join("\n");

  const packages = splitLegacyStudentBookMarkdown(markdown);
  const unit7 = packages.find((item) => item.sourceLessonNumber === 7);
  const use = unit7.candidates.filter((item) => item.sectionKey === "use");
  assert.equal(use.length, 1);
  assert.doesNotMatch(use[0].rawText, /charm/, "词表不能进 use");
  assert.equal(use[0].rawText.includes("revision speaking"), true);
}

/**
 * 复习单元写了 `UNIT 7` 的册次不能再按命名边界切一次。
 *
 * 两种写法都要对：有的册次复习单元有 `UNIT 7` 标题，有的（寒假册）只有
 * `Vocabulary Revision`。同时命中时命名边界必须让位，否则第 7 讲被切出两个包。
 */
function testNamedBoundaryYieldsToNumberedHeading() {
  const markdown = [
    "# UNIT7",
    "",
    "## Vocabulary Revision",
    "",
    "revision vocabulary",
  ].join("\n");

  const packages = splitLegacyStudentBookMarkdown(markdown);
  assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [7]);
  assert.equal(packages[0].candidates.length, 1);
}

/** `I can` 后面直接就是下一个栏目时，不能凭空空补一个 explore。 */
function testRecoveryDoesNotGuess() {
  const markdown = [
    "## UNIT2",
    "",
    "## I can",
    "",
    "-- use words related to shopping.",
    "",
    "## Hello Vocabulary",
    "",
    "unit two vocabulary",
  ].join("\n");

  const unit2 = splitLegacyStudentBookMarkdown(markdown)[0];
  assert.deepEqual(
    unit2.candidates.map((item) => item.sectionKey),
    ["objectives", "say"],
  );
}

const tests = [
  ["学生用书栏目映射（含 OCR 噪声）", testSectionKeyMapping],
  ["阅读栏目保留整篇课文（回归）", testReadingSectionKeepsTheArticle],
  ["课边界识别", testLessonBoundaries],
  ["栏目切分与子标题归属", testSectionSplitting],
  ["复习单元栏目可作来源（复习课）", testRevisionSectionsAreUsable],
  ["按书种分派解析器", testDispatcherPicksParserByBook],
  ["一级标题的栏目也要认（回归）", testLevelOneSectionHeadings],
  ["标题前多出噪声字符也要认（回归）", testSectionHeadingWithPrefixNoise],
  ["栏目内部的 DID YOU KNOW? 不是栏目边界（回归）", testDidYouKnowInsideSpreadIsNotABoundary],
  ["复习单元单独成讲、内容不越界（回归）", testRevisionUnitIsItsOwnLesson],
  ["写了 UNIT 7 的册次不再重复切分（回归）", testNamedBoundaryYieldsToNumberedHeading],
  ["书末词表不是课程内容（回归）", testWordListIsNotLessonContent],
  ["Hello World 标题丢失时按结构补出 explore（回归）", testRecoversMissingExploreHeading],
  ["补 explore 时不能把 I can 清单也吞进去", testRecoveryKeepsObjectivesList],
  ["结构不符时不猜（I can 后面直接是下一个栏目）", testRecoveryDoesNotGuess],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`学生用书来源解析测试通过:${tests.length} 项`);
