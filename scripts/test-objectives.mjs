import assert from "node:assert/strict";
import {
  buildDeterministicObjectives,
  buildLessonObjectivesMarkdown,
  buildObjectivesMarkdown,
  extractIcanStatements,
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

/** 学生用书常规课：固定四条，旧版 I can 提供英文主题/技能，大纲提供阅读与题型。 */
function testStudentLessonPageRegular() {
  const legacy = [
    "## In this lesson, I can",
    "",
    "-- use words about markets.",
    "",
    "-- read a magazine article for detail.",
    "",
    "-- use the passive voice.",
    "",
    "-- write a short email.",
  ].join(String.fromCharCode(10));
  const markdown = buildLessonObjectivesMarkdown(FULL_PROFILE, { sourceText: legacy });
  assert.deepEqual(
    markdown.split(String.fromCharCode(10)).filter((line) => line.startsWith("- ")),
    [
      "- learn words about markets.",
      "- read the article Beautiful villages.",
      "- learn the grammar of the passive voice.",
      "- practise the use of Listening Part 3.",
    ],
  );

  // 没有旧版 I can、语法列也只有中文：不搬中文，只保留可用英文项
  const fallback = buildLessonObjectivesMarkdown(FULL_PROFILE);
  assert.deepEqual(
    fallback.split(String.fromCharCode(10)).filter((line) => line.startsWith("- ")),
    ["- read the article Beautiful villages.", "- practise the use of Listening Part 3."],
  );
  assert.doesNotMatch(fallback, /[㐀-鿿]/u, "英文目标页不能出现中文");

  // 考试技能未列时，用大纲的阅读题型作为第四条
  const withReadingType = buildLessonObjectivesMarkdown({
    ...FULL_PROFILE,
    examSkills: null,
    readingExamType: "FCE Reading Part 7",
  });
  assert.match(withReadingType, /- practise the use of FCE Reading Part 7\./u);

  // 全空 → 不生成
  assert.equal(
    buildLessonObjectivesMarkdown({ theme: "", coreVocabulary: "", reading: "", grammar: "", examSkills: "" }),
    null,
  );
}

/** I can 抽取：去掉标题/注释/项目符号，过滤中文，保留原文（不做 OCR 猜测性修补）。 */
function testExtractIcanStatements() {
  const text = [
    "## In this lesson, I can",
    "",
    "<!-- image: x.jpg -->",
    "-- usewords related to weather and natural phenomena.",
    "-- usethe zero and first conditional.",
    "-- read a magazine article for general idea and for detail.",
    "-- 中文说明不应进入英文目标",
    "",
  ].join(String.fromCharCode(10));
  assert.deepEqual(extractIcanStatements(text), [
    "use words related to weather and natural phenomena.",
    "use the zero and first conditional.",
    "read a magazine article for general idea and for detail.",
  ]);
  assert.deepEqual(extractIcanStatements(null), []);
  assert.deepEqual(extractIcanStatements("I can use question tags."), ["use question tags."]);
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
  ["学生用书常规课：优先旧版 I can，不搬中文", testStudentLessonPageRegular],
  ["I can 清单抽取", testExtractIcanStatements],
  ["学生用书复习课三条固定目标（大纲为空也出）", testStudentLessonPageRevision],
  ["按目录的 deterministic 分派", testDispatch],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`课时目标生成测试通过:${tests.length} 项`);
