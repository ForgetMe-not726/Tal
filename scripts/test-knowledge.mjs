import assert from "node:assert/strict";
import { selectKnowledgeCandidates } from "../lib/knowledge/retrieval-core.ts";
import { buildMigrationPlan } from "../lib/generation/planner.ts";

const date = "2026-09-08T00:00:00.000Z";

function entry(sourceRef, layer, content) {
  return {
    id: sourceRef,
    layer,
    entry_type: "module_text",
    title: sourceRef,
    content,
    payload: { source_status: "confirmed" },
    project_id: "p",
    grade: "L5",
    lesson_id: "l",
    book_type: "knowledge",
    module_key: "lets_say",
    source_module_id: "s",
    source_ref: sourceRef,
    created_at: date,
  };
}

function candidate(sourceRef, layer, exactness, reason = "lesson_source") {
  return {
    entry: entry(sourceRef, layer, "content"),
    sourceModule: null,
    mapping: null,
    targetDefinition: null,
    reason,
    exactness,
    rank: 0,
  };
}

function testLayerAndMappingPrecedence() {
  const result = selectKnowledgeCandidates(
    [
      candidate("reference", "reference_materials", 1),
      candidate("mapped", "production_source", 0.6, "mapped_source"),
      candidate("duplicate", "production_source", 0.2),
      candidate("duplicate", "production_source", 1, "mapped_source"),
      candidate("standard", "authoritative_standards", 1),
    ],
    { maxEntries: 10, maxChars: 100 },
  );
  assert.deepEqual(result.selected.map((item) => item.entry.source_ref), [
    "duplicate",
    "mapped",
    "standard",
    "reference",
  ]);
  assert.equal(result.selected[0].reason, "mapped_source");
}

function testBudget() {
  const result = selectKnowledgeCandidates(
    [candidate("a", "production_source", 1), candidate("b", "production_source", 1)],
    { maxEntries: 10, maxChars: 10 },
  );
  assert.equal(result.selected.length, 1);
  assert.equal(result.omittedByBudget, 1);
}

function testPlannerKeepsHumanReviewForMissingStructure() {
  const plan = buildMigrationPlan({
    moduleKey: "lets_say",
    moduleLabel: "Let's say!",
    entries: [
      {
        ...candidate("source-1", "production_source", 1, "mapped_source"),
        entry: { ...entry("source-1", "production_source", "# 已有\n\ncontent") },
      },
    ],
    rules: [
      {
        rule: {
          id: "r",
          rule_key: "structure",
          display_name: "structure",
          rule_type: "generation",
          is_hard: false,
          description: "",
          created_at: date,
          updated_at: date,
        },
        version: {
          id: "v",
          rule_id: "r",
          version_number: 1,
          instruction: "",
          constraints: { required_sections: ["新增结构"], required_sections_ordered: true },
          status: "published",
          created_by: "test",
          change_note: "",
          created_at: date,
          published_at: date,
        },
        binding: {
          id: "b",
          rule_id: "r",
          scope: "global",
          project_id: null,
          grade: null,
          book_type: null,
          module_key: null,
          lesson_id: null,
          created_at: date,
        },
        specificity: 0,
      },
    ],
  });
  assert.equal(plan.summary.copy, 1);
  assert.equal(plan.summary.generate, 1);
  assert.equal(plan.requiresHumanReview, true);
}

const tests = [
  ["layer and mapping precedence", testLayerAndMappingPrecedence],
  ["retrieval budget", testBudget],
  ["migration plan human review", testPlannerKeepsHumanReviewForMissingStructure],
];
for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`知识库检索与迁移计划测试通过:${tests.length} 项`);
