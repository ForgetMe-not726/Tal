import assert from "node:assert/strict";
import { confirmLegacyMapping } from "../lib/outline/annotations.ts";
import {
  filterLegacyCandidatesForLesson,
  sourceUnitForTargetLesson,
  splitLegacyKnowledgeMarkdown,
} from "../lib/knowledge/legacy-markdown.ts";

const markdown = `# 第1讲 知识清单

## 一、词汇复习：

old vocabulary

## 阅读词汇及短语：

old reading

## 二、语法复习：

old grammar

## 三、巩固建议：

source only

## 第5讲 知识清单

## 一、词汇复习:

unit five vocabulary

## 二、语法复习：

unit five grammar

# 第6讲 知识清单

## 一、词汇复习：

unit six vocabulary

# 第7讲 知识清单

## 一、词汇复习：

unit seven vocabulary

## 二、巩固建议：

revision only
`;

const packages = splitLegacyKnowledgeMarkdown(markdown);
assert.deepEqual(packages.map((item) => item.sourceLessonNumber), [1, 5, 6, 7]);
assert.equal(packages[0].candidates.find((item) => item.sectionKey === "say")?.rawText.includes("old vocabulary"), true);
assert.equal(packages[0].candidates.find((item) => item.sectionKey === "consolidation")?.sourceOnly, true);
assert.equal(packages[3].candidates[0]?.sourceOnly, true);
assert.equal(filterLegacyCandidatesForLesson(packages, 6).length, 1);
assert.equal(filterLegacyCandidatesForLesson(packages, null).length, 0);

const mapping = confirmLegacyMapping({
  source: "Unit 6",
  target: null,
  action: null,
  status: "pending",
  scope: "lesson",
  reason: null,
  note: null,
  locator: { sheet: "Sheet1", address: "A7", row: 7, column: 1 },
  annotationRaw: "（原Unit 6）",
  legacySourceUnit: 6,
}, 5);
assert.equal(mapping.status, "confirmed");
assert.equal(mapping.source, "Unit 6");
assert.equal(mapping.target, "Lesson 5");
assert.equal(mapping.action, null);

// 有变更标注时以标注为准
assert.equal(sourceUnitForTargetLesson({ lessonNumber: 5, mappings: [mapping] }), 6);
assert.equal(sourceUnitForTargetLesson({ lessonNumber: 5, mappings: [mapping] }) !== 5, true);
// 没有标注时按课时编号一一对应
assert.equal(sourceUnitForTargetLesson({ lessonNumber: 3, mappings: [] }), 3);
assert.equal(sourceUnitForTargetLesson({ lessonNumber: 4, mappings: [] }), 4);

// “只作来源讲次”是可覆盖的策略，不是写死在逻辑里的字面量
{
  const sectionOf = (packages, lessonNumber, sectionKey) =>
    packages
      .filter((item) => item.sourceLessonNumber === lessonNumber)
      .flatMap((item) => item.candidates)
      .find((item) => item.sectionKey === sectionKey);

  // 默认：第 7 讲整讲只作来源，即使它的栏目本身可以生成
  const byDefault = splitLegacyKnowledgeMarkdown(markdown);
  assert.equal(sectionOf(byDefault, 7, "say")?.sourceOnly, true);
  assert.equal(sectionOf(byDefault, 5, "say")?.sourceOnly, false);

  // 覆盖后：改为第 1 讲只作来源，第 7 讲恢复可生成
  const overridden = splitLegacyKnowledgeMarkdown(markdown, { sourceOnlyLessons: [1] });
  assert.equal(sectionOf(overridden, 1, "say")?.sourceOnly, true);
  assert.equal(sectionOf(overridden, 7, "say")?.sourceOnly, false);

  // 栏目级规则不受讲次覆盖影响
  assert.equal(sectionOf(byDefault, 7, "consolidation")?.sourceOnly, true);
  assert.equal(sectionOf(overridden, 7, "consolidation")?.sourceOnly, true);
  console.log("✓ source-only lessons are configurable");
}

console.log("✓ legacy lecture and section splitting");
console.log("✓ Unit 6 to Lesson 5 override plus default one-to-one mapping");
console.log("旧版知识清单解析测试通过:4 项");
