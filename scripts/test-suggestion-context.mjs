import assert from "node:assert/strict";
import {
  lessonContextFrom,
  renderSuggestionPrompt,
  truncateForBudget,
} from "../lib/suggestions/context-pack.ts";
import { constraintConflicts, describeConflict, normalizeConstraintKey } from "../lib/rules/conflicts.ts";
import { parseSuggestions } from "../lib/suggestions/parse.ts";

// ---------------------------------------------------------------------------
// 造一条生效规则（形状照 `EffectiveRule`）
// ---------------------------------------------------------------------------

function rule(ruleKey, options = {}) {
  const {
    isHard = false,
    scope = "global",
    specificity = 0,
    constraints = {},
    instruction = "指令",
    displayName = ruleKey,
  } = options;
  return {
    rule: {
      id: ruleKey,
      rule_key: ruleKey,
      display_name: displayName,
      rule_type: "generation",
      is_hard: isHard,
      description: "",
      payload: {},
      created_at: "",
      updated_at: "",
    },
    version: {
      id: `${ruleKey}-v1`,
      rule_id: ruleKey,
      version_number: 1,
      instruction,
      constraints,
      status: "published",
      created_by: "test",
      change_note: "",
      created_at: "",
      published_at: null,
    },
    binding: {
      id: `b-${ruleKey}`,
      rule_id: ruleKey,
      scope,
      project_id: null,
      grade: null,
      book_type: null,
      module_key: null,
      lesson_id: null,
      created_at: "",
    },
    specificity,
  };
}

function pack(overrides = {}) {
  return {
    teacherRequest: "把阅读难度调低一点",
    module: {
      bookType: "student",
      moduleKey: "lets_read",
      moduleLabel: "Let's read",
      lessonNumber: 1,
      lessonTitle: "Fond memories",
      versionId: "v-1",
      versionNumber: 2,
      markdown: "## Let's read!\n\n正文",
    },
    lessonContext: { theme: "乡村生活", grammar: "反义疑问句" },
    rules: {
      entries: [
        {
          ruleKey: "LANG-001",
          displayName: "当代标准英式英语",
          scope: "global",
          isHard: true,
          versionNumber: 1,
          specificity: 0,
          instruction: "逐词逐句核对英式英语。",
          constraints: {},
        },
      ],
      conflicts: [],
    },
    related: [],
    evidence: [],
    gaps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Context Pack 的渲染：七部分一个都不能少
// ---------------------------------------------------------------------------

function testPromptCarriesEveryPart() {
  const prompt = renderSuggestionPrompt(
    pack({
      rules: {
        entries: [
          {
            ruleKey: "LANG-001",
            displayName: "当代标准英式英语",
            scope: "global",
            isHard: true,
            versionNumber: 1,
            specificity: 0,
            instruction: "逐词逐句核对英式英语。",
            constraints: { banned_words: ["color"] },
          },
        ],
        conflicts: [{ key: "min_words", summary: "min_words：A（module，红线）= 60；B（book）= 80" }],
      },
      related: [{ label: "workbook/day_1 Day 1", markdown: "练习册正文" }],
      evidence: [
        {
          label: "Cambridge B1 词表",
          sourceRef: "cambridge:b1#a1",
          layer: "authoritative_standards",
          page: 12,
          ocrJobId: null,
          excerpt: "片段",
        },
      ],
      gaps: [{ kind: "no_reference_material", message: "本地没有已确认的参考资料。" }],
    }),
  );

  for (const heading of [
    "老师的要求（本次任务目标）",
    "当前模块",
    "本课目标（大纲",
    "规则参考知识库",
    "规则冲突",
    "同一 Lesson 的其他已确认内容",
    "本地参考资料",
    "资料缺口",
    "待修改正文",
  ]) {
    assert.match(prompt, new RegExp(heading), `Prompt 少了「${heading}」`);
  }
  // 规则要带 ID、作用域、硬度、约束
  assert.match(prompt, /LANG-001/);
  assert.match(prompt, /红线/);
  assert.match(prompt, /banned_words/);
  // 来源定位要进 Prompt
  assert.match(prompt, /cambridge:b1#a1/);
  assert.match(prompt, /p\.12/);
  // 规则是参考而不是门禁：口径必须写在要求里
  assert.match(prompt, /不要逐条机械对照/);
  assert.match(prompt, /老师的要求是本次任务目标/);
}

/** 没有依据时不能假装有：缺口段落必须如实说"没有"。 */
function testEmptyPackIsHonest() {
  const prompt = renderSuggestionPrompt(
    pack({
      lessonContext: null,
      rules: { entries: [], conflicts: [] },
      gaps: [{ kind: "no_lesson_context", message: "这一版没有记录本课目标（大纲）。" }],
    }),
  );
  assert.match(prompt, /（本次没有大纲信息）/);
  assert.match(prompt, /（本次没有生效规则）/);
  assert.match(prompt, /（本地没有已确认的参考资料）/);
  assert.match(prompt, /这一版没有记录本课目标/);
}

function testTruncateForBudget() {
  assert.deepEqual(truncateForBudget("abc", 10), { text: "abc", truncated: false });
  assert.deepEqual(truncateForBudget("abcdef", 3), { text: "abc", truncated: true });
  assert.equal(truncateForBudget("", 3).truncated, false);
}

/** Lesson Context 从版本 metadata 里读；没有就返回 null，不猜。 */
function testLessonContextFrom() {
  assert.deepEqual(lessonContextFrom({ lesson_profile: { theme: "乡村", coreVocabulary: null } }), {
    theme: "乡村",
  });
  assert.equal(lessonContextFrom({}), null);
  assert.equal(lessonContextFrom({ lesson_profile: {} }), null);
  assert.equal(lessonContextFrom(null), null);
  assert.equal(lessonContextFrom({ lesson_profile: [] }), null);
}

// ---------------------------------------------------------------------------
// 规则冲突
// ---------------------------------------------------------------------------

function testConflictDetection() {
  // 别名对必须归一：min_words 与 words_per_lesson_min 是同一个概念
  assert.equal(normalizeConstraintKey("words_per_lesson_min"), "min_words");
  assert.equal(normalizeConstraintKey("words_per_lesson_max"), "max_words");
  assert.equal(normalizeConstraintKey("banned_words"), "banned_words");

  // 不同值 → 冲突
  const conflicting = constraintConflicts([
    rule("R-A", { constraints: { min_words: 60 } }),
    rule("R-B", { scope: "book", specificity: 3, constraints: { words_per_lesson_min: 80 } }),
  ]);
  assert.equal(conflicting.length, 1);
  assert.equal(conflicting[0].key, "min_words", "别名归一到同一个键");
  assert.equal(conflicting[0].conflicting, true);
  assert.match(describeConflict(conflicting[0]), /R-A/);
  assert.match(describeConflict(conflicting[0]), /R-B/);

  // 同值只是重复 → 不算冲突（否则规则库里正常的多层写法会刷一屏噪声）
  assert.deepEqual(
    constraintConflicts([
      rule("R-C", { constraints: { min_words: 60 } }),
      rule("R-D", { scope: "book", specificity: 3, constraints: { min_words: 60 } }),
    ]),
    [],
  );

  // 只有一条规则设置 → 没有冲突可言
  assert.deepEqual(constraintConflicts([rule("R-E", { constraints: { min_words: 60 } })]), []);

  // 红线在最宽作用域、更具体的规则给了不同的值 → 那条值不会生效
  const overridden = constraintConflicts([
    rule("R-HARD", { isHard: true, scope: "global", specificity: 0, constraints: { min_words: 60 } }),
    rule("R-SOFT", { scope: "module", specificity: 4, constraints: { min_words: 90 } }),
  ]);
  assert.equal(overridden[0].overriddenHard, true);
  assert.match(describeConflict(overridden[0]), /红线优先/);

  // 反过来（红线在更具体的作用域）不算被覆盖
  const notOverridden = constraintConflicts([
    rule("R-HARD2", { isHard: true, scope: "module", specificity: 4, constraints: { min_words: 90 } }),
    rule("R-SOFT2", { scope: "global", specificity: 0, constraints: { min_words: 60 } }),
  ]);
  assert.equal(notOverridden[0].overriddenHard, false);

  // 不同约束键之间互不干扰
  assert.deepEqual(
    constraintConflicts([
      rule("R-F", { constraints: { min_words: 60 } }),
      rule("R-G", { constraints: { max_words: 90 } }),
    ]),
    [],
  );

  // **列表类约束是累加的，不是冲突**：实测工作区里 4 条规则各给一份 banned_words，
  // 合起来就是"这些词都不能出现"，取并集即可。按"值不同就冲突"报会每跑一次喊一次狼。
  assert.deepEqual(
    constraintConflicts([
      rule("R-SB-005", { constraints: { banned_words: ["TODO"] } }),
      rule("R-WB-009", { constraints: { banned_words: ["参考答案", "答案:"] } }),
    ]),
    [],
    "禁用词表取并集，不算冲突",
  );

  // 顺序敏感的那条是真冲突：章节顺序没有"合并"一说
  assert.equal(
    constraintConflicts([
      rule("R-ORD-A", { constraints: { required_sections_ordered: ["lets_say", "lets_read"] } }),
      rule("R-ORD-B", { constraints: { required_sections_ordered: ["lets_read", "lets_say"] } }),
    ]).length,
    1,
  );

  // 一边列表一边数字 → 写法不一致，报出来
  assert.equal(
    constraintConflicts([
      rule("R-MIX-A", { constraints: { required_sections: ["lets_say"] } }),
      rule("R-MIX-B", { constraints: { required_sections: 3 } }),
    ]).length,
    1,
  );
}

// ---------------------------------------------------------------------------
// 建议解析与依据校验
// ---------------------------------------------------------------------------

const EVIDENCE = [
  { label: "Cambridge B1 词表", sourceRef: "cambridge:b1#a1", page: 12, ocrJobId: null },
];

function testParseKeepsBasis() {
  const parsed = parseSuggestions(
    JSON.stringify({
      suggestions: [
        {
          kind: "replace",
          original_text: "colour",
          replacement_text: "color",
          reason: "英式拼写",
          rule_ids: ["LANG-001"],
          evidence: ["cambridge:b1#a1"],
          uncertainty: "词表只作支持性证据",
          confidence: 0.8,
        },
      ],
    }),
    { ruleKeys: ["LANG-001", "TYPO-001"], evidence: EVIDENCE },
  );
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].ruleKeys, ["LANG-001"]);
  assert.deepEqual(parsed[0].evidence, EVIDENCE);
  assert.equal(parsed[0].uncertainty, "词表只作支持性证据");
  assert.equal(parsed[0].confidence, 0.8);
}

/**
 * 模型编造的依据比不给依据更糟——老师会以为那条结论有出处。
 * 给了白名单就只认白名单里的。
 */
function testUnknownBasisIsDropped() {
  const parsed = parseSuggestions(
    JSON.stringify({
      suggestions: [
        {
          kind: "replace",
          original_text: "a",
          replacement_text: "b",
          reason: "r",
          rule_ids: ["LANG-001", "编造的规则"],
          evidence: ["cambridge:b1#a1", "编造的来源"],
        },
      ],
    }),
    { ruleKeys: ["LANG-001"], evidence: EVIDENCE },
  );
  assert.deepEqual(parsed[0].ruleKeys, ["LANG-001"]);
  assert.deepEqual(parsed[0].evidence, EVIDENCE);

  // 全部编造 → 干脆不写依据，而不是留一个空数组冒充"有依据"
  const empty = parseSuggestions(
    JSON.stringify({ suggestions: [{ kind: "note", message: "x", rule_ids: ["编造"], evidence: ["编造"] }] }),
    { ruleKeys: ["LANG-001"], evidence: EVIDENCE },
  );
  assert.equal("ruleKeys" in empty[0], false);
  assert.equal("evidence" in empty[0], false);
}

/** 不给白名单时不校验（既有调用方式保持可用）。 */
function testParseWithoutContextKeepsRaw() {
  const parsed = parseSuggestions(
    JSON.stringify({ suggestions: [{ kind: "note", message: "x", rule_ids: ["任意"], uncertainty: "缺资料" }] }),
  );
  assert.deepEqual(parsed[0].ruleKeys, ["任意"]);
  assert.equal(parsed[0].uncertainty, "缺资料");
}

/** 不可解析时仍只回一条 note，且**不携带可执行的 replacementText**。 */
function testUnparseableStaysSafe() {
  const parsed = parseSuggestions("模型今天不想干活");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kind, "note");
  assert.equal(parsed[0].replacementText, "");
  assert.equal(parsed[0].originalText, "");
}

const tests = [
  ["Prompt 七部分齐全且规则是参考口径", testPromptCarriesEveryPart],
  ["没有依据时如实说没有", testEmptyPackIsHonest],
  ["正文按预算截断", testTruncateForBudget],
  ["Lesson Context 只从版本记录读", testLessonContextFrom],
  ["约束冲突：别名归一、列表累加、红线覆盖", testConflictDetection],
  ["建议解析保留规则与来源依据", testParseKeepsBasis],
  ["编造的规则 ID 与来源被丢掉", testUnknownBasisIsDropped],
  ["不给白名单时不校验", testParseWithoutContextKeepsRaw],
  ["不可解析时只回一条 note 且不带可执行替换", testUnparseableStaysSafe],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`修改建议 Context Pack 测试通过:${tests.length} 项`);
