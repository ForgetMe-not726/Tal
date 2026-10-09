import assert from "node:assert/strict";
import {
  buildEffectiveRuleSet,
  filterRuleSetByType,
  RuleResolverError,
} from "../lib/rules/resolve-core.ts";
import { runDeterministicChecks, unknownConstraintKeys, KNOWN_CONSTRAINT_KEYS } from "../lib/rules/checks.ts";

const baseDate = "2026-09-03T00:00:00.000Z";

function rule(id, ruleKey, isHard = false, ruleType = "generation") {
  return {
    id,
    rule_key: ruleKey,
    display_name: ruleKey,
    rule_type: ruleType,
    is_hard: isHard,
    description: "test",
    created_at: baseDate,
    updated_at: baseDate,
  };
}

function version(id, ruleId, versionNumber, constraints = {}) {
  return {
    id,
    rule_id: ruleId,
    version_number: versionNumber,
    instruction: `instruction-${versionNumber}`,
    constraints,
    status: "published",
    created_by: "test",
    change_note: "",
    created_at: baseDate,
    published_at: baseDate,
  };
}

function binding(id, ruleId, scope, extra = {}) {
  return {
    id,
    rule_id: ruleId,
    scope,
    project_id: null,
    grade: null,
    book_type: null,
    module_key: null,
    lesson_id: null,
    created_at: baseDate,
    ...extra,
  };
}

function fixture() {
  const normal = rule("rule-normal", "word_limit");
  const hard = rule("rule-hard", "language_redline", true, "review");
  return {
    rules: [normal, hard],
    publishedVersions: [
      version("version-normal", normal.id, 1, { min_words: 3 }),
      version("version-hard", hard.id, 1, { banned_words: ["gonna"] }),
    ],
    bindings: [
      binding("binding-normal-global", normal.id, "global"),
      binding("binding-normal-module", normal.id, "module", { module_key: "lets_explore" }),
      binding("binding-hard-global", hard.id, "global"),
      binding("binding-hard-lesson", hard.id, "lesson", {
        lesson_id: "11111111-1111-4111-8111-111111111111",
      }),
    ],
  };
}

function testScopePrecedence() {
  const result = buildEffectiveRuleSet({
    ...fixture(),
    context: {
      grade: "L3",
      moduleKey: "lets_explore",
      lessonId: "11111111-1111-4111-8111-111111111111",
    },
    resolvedAt: baseDate,
  });

  assert.equal(result.scopedRules[0].rule.rule_key, "word_limit");
  assert.equal(result.scopedRules[0].binding.scope, "module");
  assert.equal(result.hardRules[0].rule.rule_key, "language_redline");
  assert.equal(result.hardRules[0].binding.scope, "global");
  assert.equal(result.snapshot.rules[0].scope, "global");
  assert.deepEqual(JSON.parse(JSON.stringify(result.snapshot)), result.snapshot);
}

function testGlobalFallback() {
  const { rules, publishedVersions, bindings } = fixture();
  const result = buildEffectiveRuleSet({
    rules,
    publishedVersions,
    bindings,
    context: { grade: "L3", moduleKey: "other_module" },
    resolvedAt: baseDate,
  });
  assert.equal(result.allRules.length, 2);
  assert.equal(result.scopedRules[0].binding.scope, "global");
}

function testInvalidPublishedState() {
  const { rules, publishedVersions, bindings } = fixture();
  assert.throws(
    () =>
      buildEffectiveRuleSet({
        rules,
        publishedVersions: [
          ...publishedVersions,
          version("version-normal-2", "rule-normal", 2),
        ],
        bindings,
      }),
    (error) => error instanceof RuleResolverError && /多个 Published/.test(error.message),
  );
}

function testDeterministicChecks() {
  const normal = rule("rule-check", "structure_primary");
  const effective = {
    rule: normal,
    version: version("version-check", normal.id, 1, {
      words_per_lesson_min: 5,
      words_per_lesson_max: 8,
      banned_words: ["gonna"],
      reading_sections_required: ["阅读任务"],
    }),
    binding: binding("binding-check", normal.id, "global"),
    specificity: 0,
  };
  const issues = runDeterministicChecks([effective], {
    text: "We are gonna read this short lesson.",
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ["banned_words", "required_sections"],
  );

  const passing = runDeterministicChecks([effective], {
    text: "We read a useful lesson with friends today.",
    sections: ["阅读任务"],
  });
  assert.equal(passing.length, 0);

  const annotationRule = rule("rule-source", "source_annotation");
  const annotationEffective = {
    rule: annotationRule,
    version: version("version-source", annotationRule.id, 1, {
      require_source_annotation: true,
    }),
    binding: binding("binding-source", annotationRule.id, "global"),
    specificity: 0,
  };
  assert.equal(runDeterministicChecks([annotationEffective], { text: "content" })[0].code, "source_annotation");
  assert.equal(
    runDeterministicChecks([annotationEffective], {
      text: "content [source-1]",
      metadata: { sourceAnnotations: ["source-1"] },
    }).length,
    0,
  );
}

/** 检查器不认识的约束字段要被报出来，避免拼错字段名后以为规则已生效。 */
function testUnknownConstraintKeys() {
  assert.deepEqual(unknownConstraintKeys({ min_words: 60, banned_words: ["x"] }), []);
  assert.deepEqual(unknownConstraintKeys({ min_word: 60, lessons_per_unit: 3 }), [
    "lessons_per_unit",
    "min_word",
  ]);
  // 每个已知字段都要在检查器里真的被读过，这里只做清单自检
  assert.equal(KNOWN_CONSTRAINT_KEYS.includes("required_sections_ordered"), true);
  assert.deepEqual(unknownConstraintKeys({}), []);
}

/**
 * 生成与审校必须分流：两边检查的是不同的东西。
 *
 * 审校规则进生成 Prompt 只会挤占上下文、Hard 项还会在保存时挡住老师；
 * 生成规则进审校侧则会产出"词数不够"这类与教材本身无关的噪声。
 * `snapshot` 跟着过滤——版本记录里存的必须是**本次实际用到**的规则。
 */
function testRuleTypeSeparation() {
  const result = buildEffectiveRuleSet({
    ...fixture(),
    context: {
      grade: "L3",
      moduleKey: "lets_explore",
      lessonId: "11111111-1111-4111-8111-111111111111",
    },
    resolvedAt: baseDate,
  });
  assert.equal(result.allRules.length, 2, "前提：一条生成规则、一条审校规则");

  const generation = filterRuleSetByType(result, "generation");
  assert.deepEqual(generation.allRules.map((item) => item.rule.rule_key), ["word_limit"]);
  assert.equal(generation.hardRules.length, 0, "Hard 的审校规则不进生成侧");
  assert.equal(generation.scopedRules.length, 1);
  assert.deepEqual(generation.snapshot.rules.map((entry) => entry.rule_type), ["generation"]);

  const review = filterRuleSetByType(result, "review");
  assert.deepEqual(review.allRules.map((item) => item.rule.rule_key), ["language_redline"]);
  assert.equal(review.hardRules.length, 1);
  assert.equal(review.scopedRules.length, 0);
  assert.deepEqual(review.snapshot.rules.map((entry) => entry.rule_type), ["review"]);

  // 分流不丢规则：两边加起来就是全体
  assert.equal(generation.allRules.length + review.allRules.length, result.allRules.length);

  // 一条都不匹配时返回空集，而不是抛错、也不是退回全体
  const none = filterRuleSetByType(generation, "review");
  assert.deepEqual(none.allRules, []);
  assert.deepEqual(none.snapshot.rules, []);

  // 过滤不改变原集合（纯函数）
  assert.equal(result.allRules.length, 2);
}

const tests = [
  ["scope precedence and hard rule", testScopePrecedence],
  ["global fallback", testGlobalFallback],
  ["invalid published state", testInvalidPublishedState],
  ["deterministic checks", testDeterministicChecks],
  ["unknown constraint keys", testUnknownConstraintKeys],
  ["生成与审校规则按类型分流", testRuleTypeSeparation],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`规则引擎测试通过:${tests.length} 项`);
