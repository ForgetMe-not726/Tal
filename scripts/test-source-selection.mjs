import assert from "node:assert/strict";
import { missingSourceMessage, selectSourceText, outlineSourceText } from "../lib/knowledge/source-selection.ts";
import { findModuleOutline } from "../lib/modules/directory.ts";

const OUTLINE_LESSON = {
  lessonNumber: 1,
  title: "Fond memories",
  theme: "Memories",
  coreVocabulary: "charm, inhabitant",
  reading: "Fond memories",
  grammar: "Question tags",
  examSkills: "Reading Part 7",
};

const candidate = (sectionKey, rawText) => ({
  id: `c-${sectionKey}`,
  sourceLessonNumber: 1,
  sourceHeading: "# UNIT1",
  sectionKey,
  sectionLabel: sectionKey,
  rawText,
  lineStart: 1,
  lineEnd: 2,
  sourceRef: `legacy:lesson-1:${sectionKey}`,
  sourceOnly: false,
});

function base(overrides) {
  return {
    module: undefined,
    candidates: [],
    outlineLesson: null,
    hasLegacyPackages: false,
    rawSourceText: "",
    ...overrides,
  };
}

/**
 * 回归：知识清单的「学习目标」必须能在导入旧版 OCR 后照常生成。
 *
 * 曾经的 bug：判断"是否只依赖大纲"看的是 sourceSections 里有没有 objectives，
 * 而知识清单的 learning_objectives 的 sourceSections 是空数组（只有学生用书是
 * ["objectives"]），于是导入过 OCR 后返回 null，生成报「没有可用的来源内容」。
 */
function testKnowledgeObjectivesStillResolves() {
  const knowledgeObjectives = findModuleOutline("knowledge", "learning_objectives");
  assert.equal(knowledgeObjectives.deterministic, "objectives_table");
  assert.deepEqual(knowledgeObjectives.sourceSections, []);

  const text = selectSourceText(
    base({
      module: knowledgeObjectives,
      outlineLesson: OUTLINE_LESSON,
      // 关键：导入过旧版 OCR，此时不能因为"有 packages 但没匹配栏目"就返回 null
      hasLegacyPackages: true,
      candidates: [candidate("say", "词汇复习内容")],
    }),
  );
  assert.ok(text, "知识清单学习目标必须有来源文本");
  assert.match(text, /Fond memories/);
  assert.match(text, /核心词汇：charm, inhabitant/);
}

/**
 * 学生用书的课时目标也走确定性分支。
 *
 * 它同时有 deterministic 和旧版 `I can` 栏目——确定性分支必须优先，
 * 否则被记成"来源"的会是旧版块，而内容其实是大纲算出来的。
 */
function testStudentObjectivesPrefersOutline() {
  const studentObjectives = findModuleOutline("student", "learning_objectives");
  assert.equal(studentObjectives.deterministic, "objectives_lesson_page");
  assert.deepEqual(studentObjectives.sourceSections, ["objectives"]);

  const text = selectSourceText(
    base({
      module: studentObjectives,
      outlineLesson: OUTLINE_LESSON,
      hasLegacyPackages: true,
      candidates: [candidate("objectives", "I can use question tags")],
    }),
  );
  assert.ok(text);
  assert.match(text, /Question tags/);
  assert.doesNotMatch(text, /I can use question tags/, "确定性模块的来源应是大纲，不是旧版块");
}

/** 大纲字段为空时不编造。 */
function testOutlineSourceTextSkipsMissingFields() {
  const text = outlineSourceText({
    lessonNumber: 3,
    title: "In harmony",
    theme: null,
    coreVocabulary: "  ",
    reading: "A text",
    grammar: null,
    examSkills: null,
  });
  assert.match(text, /Lesson 3 In harmony/);
  assert.match(text, /阅读：A text/);
  assert.doesNotMatch(text, /主题/);
  assert.doesNotMatch(text, /核心词汇/);
  assert.doesNotMatch(text, /语法/);
}

/** 普通模块按目录声明的栏目取来源；一个模块可以对应多个栏目。 */
function testSectionsAreCollectedInOrder() {
  const studentSay = findModuleOutline("student", "lets_say");
  assert.deepEqual(studentSay.sourceSections, ["say"]);

  const text = selectSourceText(
    base({
      module: studentSay,
      hasLegacyPackages: true,
      candidates: [
        candidate("say", "Hello Vocabulary 正文"),
        candidate("say", "Develop Your Vocabulary 正文"),
        candidate("read", "阅读课文"),
      ],
    }),
  );
  assert.match(text, /Hello Vocabulary 正文/);
  assert.match(text, /Develop Your Vocabulary 正文/);
  assert.doesNotMatch(text, /阅读课文/, "不该取别的栏目");

  // 多个栏目时按声明顺序拼接
  const multi = selectSourceText(
    base({
      module: { sourceSections: ["read", "say"] },
      hasLegacyPackages: true,
      candidates: [candidate("say", "SAY"), candidate("read", "READ")],
    }),
  );
  assert.equal(multi, "READ\n\nSAY");
}

/** 导入了旧版材料但没有对应栏目 → 返回 null，由调用方给出明确提示（不静默兜底）。 */
function testMissingSectionReturnsNull() {
  const text = selectSourceText(
    base({
      module: { sourceSections: ["read"] },
      hasLegacyPackages: true,
      candidates: [candidate("say", "只有词汇")],
    }),
  );
  assert.equal(text, null);
}

/** 完全没导入旧版材料时退回整份原文。 */
function testRawFallbackWhenNothingImported() {
  const text = selectSourceText(
    base({
      module: { sourceSections: ["read"] },
      hasLegacyPackages: false,
      rawSourceText: "  整份旧版原文  ",
    }),
  );
  assert.equal(text, "整份旧版原文");

  assert.equal(
    selectSourceText(base({ module: { sourceSections: ["read"] }, hasLegacyPackages: false })),
    null,
  );
}

/**
 * 取不到来源时要说清是「这一课旧版本来就没有」还是「整讲都没有内容」，
 * 不能让老师以为是软件坏了。
 */
function testMissingSourceMessageExplainsWhy() {
  const absent = missingSourceMessage({
    moduleLabel: "Let's read!",
    sourceLessonNumber: 2,
    stats: { usable: 3, sourceOnly: 0, hasText: true },
  });
  assert.match(absent, /旧版第 2 讲/);
  assert.match(absent, /Let's read!/);
  assert.match(absent, /可能本来就没有/, "要说清可能旧版这一课就没有该栏目");
  assert.match(absent, /OCR/, "也要提示 OCR 漏标题这一种可能");

  // 整讲只有「只作来源」的栏目（知识清单第 7 讲只有巩固建议）
  const sourceOnlyOnly = missingSourceMessage({
    moduleLabel: "Let's say!",
    sourceLessonNumber: 7,
    stats: { usable: 0, sourceOnly: 1, hasText: true },
  });
  assert.match(sourceOnlyOnly, /都只作来源/);
  assert.doesNotMatch(sourceOnlyOnly, /结构与本模块对不上/, "结构没问题，别误导成结构问题");

  // 有正文但栏目对不上（旧版练习册 Unit 7 是整课复习，题目标题认不出栏目）
  const unmatched = missingSourceMessage({
    moduleLabel: "Day 1",
    sourceLessonNumber: 7,
    stats: { usable: 0, sourceOnly: 0, hasText: true },
  });
  assert.match(unmatched, /有正文/);
  assert.match(unmatched, /栏目结构与本模块对不上/);
  assert.doesNotMatch(unmatched, /没有可生成的内容/);

  // 整讲为空
  const empty = missingSourceMessage({
    moduleLabel: "Let's say!",
    sourceLessonNumber: 7,
    stats: { usable: 0, sourceOnly: 0, hasText: false },
  });
  assert.match(empty, /旧版第 7 讲没有可生成的内容/);

  // 没解析出讲次时不能编一个号
  const noUnit = missingSourceMessage({
    moduleLabel: "Let's use!",
    sourceLessonNumber: null,
    stats: { usable: 1, sourceOnly: 0, hasText: true },
  });
  assert.match(noUnit, /旧版对应讲次/);
}

const tests = [
  ["知识清单学习目标在导入 OCR 后仍可生成（回归）", testKnowledgeObjectivesStillResolves],
  ["学生用书课时目标优先用大纲（不被旧版块冒充来源）", testStudentObjectivesPrefersOutline],
  ["大纲字段缺失时不编造", testOutlineSourceTextSkipsMissingFields],
  ["按目录栏目取来源且顺序正确", testSectionsAreCollectedInOrder],
  ["缺栏目时返回 null 而不是静默兜底", testMissingSectionReturnsNull],
  ["未导入旧版材料时退回整份原文", testRawFallbackWhenNothingImported],
  ["取不到来源时说明原因", testMissingSourceMessageExplainsWhy],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`来源选择测试通过:${tests.length} 项`);
