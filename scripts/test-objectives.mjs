import assert from "node:assert/strict";
import {
  buildDeterministicObjectives,
  buildLessonObjectivesMarkdown,
  buildObjectivesMarkdown,
} from "../lib/generation/objectives.ts";

const FULL_PROFILE = {
  theme: "关于世界各地市场的特点与各国特色市集",
  coreVocabulary: "核心词汇数量：15个\npurchase, price, resist",
  reading: "Beautiful villages\n\n阅读字数统计：569",
  grammar: "反身代词",
  examSkills: "Listening Part 3",
};

/** 知识清单：四行「字段名 + 内容」表，标题并进表格首行。 */
function testKnowledgeObjectivesTable() {
  const markdown = buildObjectivesMarkdown(FULL_PROFILE);
  assert.match(markdown, /^\| \| \|$/m, "首行是空表头，渲染时换成「学习目标」标题行");
  assert.match(markdown, /\| 目标词汇 \| purchase, price, resist \|/);
  assert.match(markdown, /\| 核心语法 \| 反身代词 \|/);
  // 数量标注要清掉，正文里不该出现
  assert.doesNotMatch(markdown, /核心词汇数量/);
  assert.doesNotMatch(markdown, /阅读字数统计/);

  // 大纲整行为空时不生成，也不写占位
  assert.equal(buildObjectivesMarkdown({ coreVocabulary: "", grammar: null, reading: "  ", examSkills: null }), null);
}

/** 学生用书常规课：四条目标，句式照成稿。 */
function testStudentLessonPageRegular() {
  const markdown = buildLessonObjectivesMarkdown(FULL_PROFILE);
  const lines = markdown.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "- learn words about 关于世界各地市场的特点与各国特色市集");
  assert.equal(lines[1], "- read the article Beautiful villages");
  assert.equal(lines[2], "- learn the grammar of 反身代词");
  assert.equal(lines[3], "- practise the use of Listening Part 3");
  assert.match(markdown, /^## In this lesson, we will\.\.\./);

  // 字段为空时整条省略，不留空行
  const partial = buildLessonObjectivesMarkdown({ ...FULL_PROFILE, reading: null, examSkills: null });
  assert.equal(partial.split("\n").filter((line) => line.startsWith("- ")).length, 2);
  assert.doesNotMatch(partial, /read the article/);

  // 全空 → 不生成
  assert.equal(buildLessonObjectivesMarkdown({ theme: "", coreVocabulary: "", reading: "", grammar: "", examSkills: "" }), null);
}

/**
 * 学生用书复习课：三条固定目标，**不取大纲字段**。
 *
 * 依据成稿样本 Lesson 15「Fun with review」。寒假册的 Lesson 7 整行为空，
 * 照常规课那样从字段拼会拼出空串、复习课直接生成不了。
 */
function testStudentLessonPageRevision() {
  const expected = [
    "- review the words from the previous lessons.",
    "- review the grammar from the previous lessons.",
    "- understand and practise the skills from the exam.",
  ];

  // 大纲为空也要出三条
  const fromEmpty = buildLessonObjectivesMarkdown(
    { theme: null, coreVocabulary: null, reading: null, grammar: null, examSkills: null },
    { revision: true },
  );
  assert.ok(fromEmpty, "复习课目标不能因为大纲为空就不生成");
  assert.deepEqual(fromEmpty.split("\n").filter((line) => line.startsWith("- ")), expected);

  // 有大纲字段时同样出这三条（复习课目标与具体内容无关）
  const fromFull = buildLessonObjectivesMarkdown(FULL_PROFILE, { revision: true });
  assert.deepEqual(fromFull.split("\n").filter((line) => line.startsWith("- ")), expected);
  assert.doesNotMatch(fromFull, /read the article/, "复习课不含阅读那一条");
}

/** 按目录里的 deterministic 分派；复习课标记要透传下去。 */
function testDispatch() {
  const empty = { theme: null, coreVocabulary: null, reading: null, grammar: null, examSkills: null };
  assert.match(buildDeterministicObjectives("objectives_lesson_page", FULL_PROFILE), /In this lesson/);
  assert.match(buildDeterministicObjectives("objectives_table", FULL_PROFILE), /学习目标|目标词汇/);
  assert.match(
    buildDeterministicObjectives("objectives_lesson_page", empty, { revision: true }),
    /review the words from the previous lessons/,
  );
  assert.equal(buildDeterministicObjectives("objectives_table", empty), null);
}

const tests = [
  ["知识清单学习目标表", testKnowledgeObjectivesTable],
  ["学生用书常规课四条目标", testStudentLessonPageRegular],
  ["学生用书复习课三条固定目标（大纲为空也出）", testStudentLessonPageRevision],
  ["按目录的 deterministic 分派", testDispatch],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`课时目标生成测试通过:${tests.length} 项`);
