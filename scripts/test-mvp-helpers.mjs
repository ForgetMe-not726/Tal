import assert from "node:assert/strict";
import { parseSuggestions } from "../lib/suggestions/parse.ts";
import { applySuggestionToMarkdown } from "../lib/suggestions/apply.ts";

const baseSuggestion = {
  id: "s1",
  kind: "replace",
  originalText: "apple",
  replacementText: "pear",
  reason: "test",
  confidence: 0.9,
};

function testParseObject() {
  const result = parseSuggestions(
    '{"suggestions":[{"kind":"replace","original_text":"a","replacement_text":"b","reason":"r","confidence":0.9}]}',
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "replace");
  assert.equal(result[0].originalText, "a");
  assert.equal(result[0].confidence, 0.9);
}

function testParseTopLevelArray() {
  const result = parseSuggestions('[{"kind":"delete","original_text":"x"}]');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "delete");
  assert.equal(result[0].replacementText, "");
}

function testParseFencedArray() {
  const result = parseSuggestions('```json\n[{"kind":"insert","original_text":"标题","replacement_text":"新增"}]\n```');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "insert");
}

function testFallbackNotActionable() {
  const result = parseSuggestions("请把第二句改得更书面。");
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "note");
  assert.equal(result[0].replacementText, "");
  assert.ok(result[0].reason.includes("请把第二句改得更书面"));
}

function testApplyReplace() {
  const result = applySuggestionToMarkdown("# 词汇\n\napple", baseSuggestion);
  assert.equal(result.changed, true);
  assert.equal(result.markdown, "# 词汇\n\npear");
}

function testApplyDelete() {
  const result = applySuggestionToMarkdown("# 词汇\n\napple pie", {
    ...baseSuggestion,
    kind: "delete",
    replacementText: "",
    originalText: "apple ",
  });
  assert.equal(result.changed, true);
  assert.equal(result.markdown, "# 词汇\n\npie");
}

function testApplyInsert() {
  const result = applySuggestionToMarkdown("# 标题", {
    ...baseSuggestion,
    kind: "insert",
    originalText: "# 标题",
    replacementText: "补充说明",
  });
  assert.equal(result.changed, true);
  assert.equal(result.markdown, "# 标题\n\n补充说明");
}

function testApplyAnchorMissing() {
  const result = applySuggestionToMarkdown("# 词汇\n\npear", baseSuggestion);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "anchor_missing");
}

function testApplyNoAnchor() {
  const result = applySuggestionToMarkdown("# 词汇", { ...baseSuggestion, kind: "note", originalText: "" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "no_anchor");
}

function testApplyNoReplacement() {
  const result = applySuggestionToMarkdown("# 词汇\n\napple", { ...baseSuggestion, replacementText: "" });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "no_replacement");
}

const tests = [
  ["parse suggestions object", testParseObject],
  ["parse top-level array", testParseTopLevelArray],
  ["parse fenced array", testParseFencedArray],
  ["fallback is not actionable", testFallbackNotActionable],
  ["apply replace", testApplyReplace],
  ["apply delete", testApplyDelete],
  ["apply insert", testApplyInsert],
  ["apply anchor missing", testApplyAnchorMissing],
  ["apply no anchor", testApplyNoAnchor],
  ["apply no replacement", testApplyNoReplacement],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`MVP 辅助测试通过:${tests.length} 项`);
