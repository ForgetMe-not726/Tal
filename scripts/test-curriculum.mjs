import assert from "node:assert/strict";
import {
  bookSupportsLessonType,
  inferLessonType,
  isRevisionLesson,
  unsupportedLessonMessage,
} from "../lib/curriculum.ts";
import { firstExamSkill } from "../lib/outline/exam-skills.ts";
import {
  buildLessonObjectivesMarkdown,
  buildObjectivesMarkdown,
} from "../lib/generation/objectives.ts";

// 复习课课次：春/秋第 5、10、15 课；夏/冬第 7 课
assert.equal(isRevisionLesson("spring", 5), true);
assert.equal(isRevisionLesson("spring", 10), true);
assert.equal(isRevisionLesson("spring", 15), true);
assert.equal(isRevisionLesson("autumn", 15), true);
assert.equal(isRevisionLesson("summer", 7), true);
assert.equal(isRevisionLesson("winter", 7), true);
assert.equal(isRevisionLesson("spring", 4), false);
assert.equal(isRevisionLesson("winter", 5), false, "冬季只有第 7 课是复习课");
assert.equal(isRevisionLesson("spring", 16), false);
assert.equal(isRevisionLesson(null, 5), false, "没有学期时不能瞎猜");

// 课型推断：课次优先，标题兜底
assert.equal(inferLessonType({ term: "spring", lessonNumber: 5, title: "Extreme weather" }), "revision");
assert.equal(inferLessonType({ term: "winter", lessonNumber: 3, title: "Revision" }), "revision");
assert.equal(inferLessonType({ term: "winter", lessonNumber: 3, title: "复习" }), "revision");
assert.equal(inferLessonType({ term: "winter", lessonNumber: 3, title: "Fond memories" }), "regular");

// 复习课没有知识清单，其余书种照常
assert.equal(bookSupportsLessonType("knowledge", "revision"), false);
assert.equal(bookSupportsLessonType("knowledge", "regular"), true);
assert.equal(bookSupportsLessonType("student", "revision"), true);
assert.equal(bookSupportsLessonType("workbook", "revision"), true);
assert.match(unsupportedLessonMessage("knowledge", "revision") ?? "", /复习课没有知识清单/u);
assert.equal(unsupportedLessonMessage("student", "revision"), null);

// 默认只做一个剑桥题型：取第一个，支持常见分隔符
assert.equal(
  firstExamSkill("Listening Part 1 / Speaking Part 3 / Writing Part 2 (informal letter)"),
  "Listening Part 1",
);
assert.equal(firstExamSkill("Reading Part 5、Writing Part 2"), "Reading Part 5");
assert.equal(firstExamSkill("Listening Part 4\nSpeaking Part 2"), "Listening Part 4");
assert.equal(firstExamSkill("Writing Part 2 (article)"), "Writing Part 2 (article)");
assert.equal(firstExamSkill(""), null);
assert.equal(firstExamSkill(null), null);

// 确定性课时目标只用第一个题型
const knowledgeObjectives = buildObjectivesMarkdown({
  coreVocabulary: "stable, harsh",
  grammar: "条件句",
  reading: "Extreme weather",
  examSkills: "Listening Part 1 / Speaking Part 3",
  primaryExamSkill: "Listening Part 1",
});
assert.ok(knowledgeObjectives);
assert.match(knowledgeObjectives, /Listening Part 1/u);
assert.doesNotMatch(knowledgeObjectives, /Speaking Part 3/u, "默认不写第二个题型");

const lessonObjectives = buildLessonObjectivesMarkdown({
  theme: "weather",
  coreVocabulary: "stable",
  grammar: "条件句",
  reading: "Extreme weather",
  examSkills: "Listening Part 1 / Speaking Part 3",
  primaryExamSkill: "Listening Part 1",
});
assert.ok(lessonObjectives);
assert.match(lessonObjectives, /practise the use of Listening Part 1/u);
assert.doesNotMatch(lessonObjectives, /Speaking Part 3/u);

// 旧调用方没带 primaryExamSkill 时退回完整字段，不静默丢信息
const fallback = buildLessonObjectivesMarkdown({
  theme: "weather",
  coreVocabulary: "stable",
  grammar: "条件句",
  reading: "Extreme weather",
  examSkills: "Listening Part 1 / Speaking Part 3",
});
assert.ok(fallback?.includes("Listening Part 1"));

console.log("课时口径与题型测试通过:8 项");
