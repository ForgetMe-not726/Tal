import assert from "node:assert/strict";
import { locateQuote, textBlocks, excerptAround } from "../lib/review/anchor.ts";
import {
  REVIEW_EXCLUDED_CONSTRAINTS,
  aggregateFindings,
  coverageFindings,
  executionModeOf,
  filterReviewConstraints,
  humanVisualFindings,
  issuesToFindings,
  orderFindings,
  reviewListRefsOf,
  rulePhase,
  standardRefsOf,
  summarize,
} from "../lib/review/pipeline.ts";
import { parseReviewFindings } from "../lib/review/llm-parse.ts";
import { buildReviewPrompt, renderRules } from "../lib/review/prompt.ts";

/** 造一条生效规则（形状照 `EffectiveRule`）。 */
function rule(ruleKey, options = {}) {
  const {
    isHard = false,
    constraints = {},
    ruleType = "generation",
    instruction = "",
    payload = {},
    displayName = ruleKey,
  } = options;
  return {
    rule: {
      id: ruleKey,
      rule_key: ruleKey,
      display_name: displayName,
      rule_type: ruleType,
      is_hard: isHard,
      description: "",
      payload,
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
      created_by: "teacher",
      change_note: "",
      created_at: "",
      published_at: null,
    },
    binding: {
      id: "b",
      rule_id: ruleKey,
      scope: "global",
      project_id: null,
      grade: null,
      book_type: null,
      module_key: null,
      lesson_id: null,
      created_at: "",
    },
    specificity: 0,
  };
}

function ruleSet(rules) {
  return {
    hardRules: rules.filter((item) => item.rule.is_hard),
    scopedRules: rules.filter((item) => !item.rule.is_hard),
    allRules: rules,
    snapshot: { schema_version: 1, context: {}, rules: [], resolved_at: "" },
  };
}

const TARGET = {
  bookType: "workbook",
  moduleId: "m-1",
  moduleKey: "day_1",
  moduleLabel: "Day 1",
  versionId: "v-1",
  versionNumber: 2,
  markdown: "## Let's say!\n\n1 Choose the correct word.\n\n## Let's talk!\n\n2 Complete the sentences.\n",
  sourceRefs: ["legacy-wb:lesson-1:say"],
};

function input(rules, extra = {}) {
  return { jobId: "j1", lessonNumber: 1, lessonType: "regular", ruleSet: ruleSet(rules), ...extra };
}

// ---------------------------------------------------------------------------
// 锚点
// ---------------------------------------------------------------------------

function testAnchor() {
  const markdown = TARGET.markdown;
  const found = locateQuote(markdown, "1 Choose the correct word.");
  assert.equal(found.quote, "1 Choose the correct word.");
  assert.equal(found.blockIndex, 1, "第二个块（0 起）");
  // 找不到就留空——不猜
  assert.deepEqual(locateQuote(markdown, "这句话不在正文里"), {
    quote: "这句话不在正文里",
    blockIndex: null,
  });
  // 空引文
  assert.deepEqual(locateQuote(markdown, "   "), { quote: "", blockIndex: null });
  assert.equal(textBlocks(markdown).length, 4);
  assert.equal(excerptAround(markdown, "Choose", 6)?.includes("Choose"), true);
  assert.equal(excerptAround(markdown, "不存在"), null);
}

// ---------------------------------------------------------------------------
// 严重度与约束过滤
// ---------------------------------------------------------------------------

/**
 * 按**教材顺序**排：模块（本次输入顺序）→ 正文位置。
 *
 * 不做严重度分级（审校标准明确不新增严重度字段）：老师拿着教材从前到后核，
 * 结论也照这个顺序给。定位不到的（文档级结论）排在同模块末尾，不插到中间。
 */
function testMaterialOrder() {
  const make = (id, moduleKey, blockIndex, ruleKey = "R-1") => ({
    id,
    ruleKey,
    ruleType: "review",
    stage: "llm_review",
    bookType: "student",
    moduleKey,
    moduleLabel: moduleKey,
    lessonNumber: 1,
    lessonType: "regular",
    versionId: "v",
    versionNumber: 1,
    anchor: { quote: "", blockIndex },
    message: id,
  });
  const order = ["student/lets_say", "student/lets_read"];
  const sorted = orderFindings(
    [
      make("D", "lets_read", 2),
      make("C", "lets_say", null),
      make("B", "lets_say", 7),
      make("A", "lets_say", 1),
      make("E", "not_in_inputs", 0),
    ],
    order,
  );
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["A", "B", "C", "D", "E"],
    "先按模块的输入顺序，再按正文位置；定位不到的排末尾，没在输入里的排最后",
  );

  // 同模块同位置的按规则 ID 定序 → 同一份输入每次排出同样结果
  const same = orderFindings(
    [make("x", "lets_say", 3, "LANG-001"), make("y", "lets_say", 3, "ALIGN-001")],
    order,
  );
  assert.deepEqual(same.map((item) => item.ruleKey), ["ALIGN-001", "LANG-001"]);

  // 不改动入参（纯函数）
  const input = [make("only", "lets_say", 1)];
  orderFindings(input, order);
  assert.equal(input.length, 1);
}

function testConstraintFiltering() {
  const filtered = filterReviewConstraints(
    rule("R-6", { constraints: { require_confirmed_source: true, min_words: 10 } }),
  );
  assert.equal("require_confirmed_source" in filtered.version.constraints, false);
  assert.equal(filtered.version.constraints.min_words, 10, "其余约束照常保留");
  assert.equal(REVIEW_EXCLUDED_CONSTRAINTS.length > 0, true);
}

// ---------------------------------------------------------------------------
// 规则检查 → Finding
// ---------------------------------------------------------------------------

function testRuleChecksBecomeFindings() {
  const findings = issuesToFindings(
    input([
      rule("R-10", { isHard: true, constraints: { banned_words: ["colour"] }, instruction: "英式英语" }),
      rule("R-11", { constraints: { min_words: 500 } }),
    ]),
    { ...TARGET, markdown: `${TARGET.markdown}\nThis colour is nice.\n` },
  );
  const banned = findings.find((item) => item.ruleKey === "R-10");
  assert.ok(banned, "禁用词要报出来");
  assert.equal(banned.stage, "rule_checks");
  assert.equal(banned.bookType, "workbook");
  assert.equal(banned.versionNumber, 2);
  assert.match(banned.message, /colour|禁用/);
  // 引文能定位时带上块序号
  assert.equal(typeof banned.anchor.quote, "string");
  const short = findings.find((item) => item.ruleKey === "R-11");
  assert.ok(short, "词数不足要报出来");
}

/**
 * 生成时门禁在审校侧不执行：`require_confirmed_source` 恒真，只会变成噪声。
 * 而 `require_source_annotation` 要用**版本自己的** source_refs 判定。
 */
function testSourceGatesAreHandledCorrectly() {
  const rules = [
    rule("R-20", { constraints: { require_confirmed_source: true } }),
    rule("R-21", { constraints: { require_source_annotation: true } }),
  ];
  // 版本带了 source_refs → 标注检查通过；门禁检查被排除
  const withRefs = issuesToFindings(input(rules), TARGET);
  assert.deepEqual(
    withRefs.map((item) => item.ruleKey),
    [],
    "门禁被排除、标注检查通过，应当没有 Finding",
  );
  // 版本没有 source_refs → 标注检查报出来
  const withoutRefs = issuesToFindings(input(rules), { ...TARGET, sourceRefs: [] });
  assert.deepEqual(
    withoutRefs.map((item) => item.ruleKey),
    ["R-21"],
  );
}

// ---------------------------------------------------------------------------
// 跨书/大纲覆盖
// ---------------------------------------------------------------------------

function testCoverageFindings() {
  const markdown = "## Let's say!\n\n1 charm and inhabitant are here.\n";
  const findings = coverageFindings(
    input([], { coreVocabulary: "核心词汇数量：3个\ncharm, inhabitant, distinctive" }),
    { ...TARGET, markdown },
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /distinctive/);
  assert.equal(findings[0].stage, "cross_book");
  assert.deepEqual(findings[0].anchor, { quote: "", blockIndex: null }, "漏词没有正文位置，不伪造");

  // 没有大纲词汇就不跑
  assert.deepEqual(coverageFindings(input([]), TARGET), []);
  assert.deepEqual(coverageFindings(input([], { coreVocabulary: "" }), TARGET), []);
  // 词汇齐全不报
  assert.deepEqual(
    coverageFindings(input([], { coreVocabulary: "charm, inhabitant" }), { ...TARGET, markdown }),
    [],
  );
}

// ---------------------------------------------------------------------------
// 聚合与统计
// ---------------------------------------------------------------------------

function testAggregate() {
  const base = {
    ruleKey: "R-30",
    ruleType: "review",
    stage: "rule_checks",
    bookType: "workbook",
    moduleKey: "day_1",
    moduleLabel: "Day 1",
    lessonNumber: 1,
    lessonType: "regular",
    versionId: "v-1",
    versionNumber: 1,
    message: "同一个问题",
  };
  const merged = aggregateFindings([
    { ...base, id: "F-1", anchor: { quote: "abc", blockIndex: 1 }, evidence: "证据" },
    { ...base, id: "F-2", anchor: { quote: "abc", blockIndex: 1 }, suggestion: "改成 xyz" },
    { ...base, id: "F-3", anchor: { quote: "不同的引文", blockIndex: 2 } },
  ]);
  assert.equal(merged.length, 2, "同规则同位置同问题合并，不同位置不合并");
  assert.equal(merged[0].evidence, "证据");
  assert.equal(merged[0].suggestion, "改成 xyz", "合并时保留另一条的建议，不丢信息");
  assert.equal(merged[0].id, "F-1", "保留先出现的（确定性检查优先于模型结论）");
}

function testSummarize() {
  const finding = (tag, bookType, action) => ({
    id: `F-${tag}-${bookType}-${action ?? "none"}`,
    ruleKey: "R",
    ruleType: null,
    stage: "rule_checks",
    bookType,
    moduleKey: "m",
    moduleLabel: "m",
    lessonNumber: 1,
    lessonType: "regular",
    versionId: "v",
    versionNumber: 1,
    anchor: { quote: "", blockIndex: null },
    message: "m",
    ...(action ? { decision: { action, decidedAt: "", decidedBy: "teacher" } } : {}),
    ...(tag === "缺证" ? { insufficientEvidence: true } : {}),
  });
  const stats = summarize([
    finding("已定", "workbook", "adopt"),
    finding("待定", "student"),
    finding("缺证", "student", "ignore"),
  ]);
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byStatus, { pending: 1, adopt: 1, ignore: 1, recheck: 0 });
  assert.deepEqual(stats.byBook, { workbook: 1, student: 2 });
  assert.equal(stats.insufficientEvidence, 1);
}

// ---------------------------------------------------------------------------
// 模型输出解析
// ---------------------------------------------------------------------------

function testLlmParsing() {
  const ok = parseReviewFindings(
    '前言\n```json\n{"findings":[{"rule_key":"R-1","severity":"major","original_text":"abc","message":"有问题","suggestion":"改成 x","evidence":"规则原文","confidence":0.8}]}\n```',
  );
  assert.equal(ok.parseFailed, false);
  assert.equal(ok.findings.length, 1);
  assert.equal(ok.findings[0].ruleKey, "R-1");
  assert.equal(ok.findings[0].confidence, 0.8);

  // 无法解析：明确标记，不静默成功
  assert.deepEqual(parseReviewFindings("模型今天不想干活"), { findings: [], parseFailed: true });
  // 缺 message 的条目丢掉
  const ragged = parseReviewFindings('{"findings":[{"message":""},{"message":"有"}]}');
  assert.equal(ragged.findings.length, 1);
  assert.equal(ragged.findings[0].ruleKey, "", "模型没写规则 ID 时留空，由调用方按资料不足处理");
}

/**
 * 审校标准的三态结果：「材料未提供无法核查」要**结构化**记下来，不能只留在 message 里。
 *
 * 认不出的 verdict 一律按 `needs_revision`——不把模型的自述当"无法核查"用，
 * 否则模型随手写个词就能把结论降级成"查不了"。
 */
function testVerdictParsing() {
  const parsed = parseReviewFindings(
    JSON.stringify({
      findings: [
        { rule_key: "ANSWER-001", verdict: "cannot_verify", message: "没给正式答案表" },
        { rule_key: "LANG-001", verdict: "needs_revision", message: "用了美式拼写" },
        { rule_key: "LEX-001", verdict: "随便写的", message: "认不出的值" },
        { rule_key: "TYPO-001", message: "没写 verdict" },
      ],
    }),
  );
  assert.deepEqual(
    parsed.findings.map((item) => item.verdict),
    ["cannot_verify", "needs_revision", "needs_revision", "needs_revision"],
  );
  // 不是这条就绝不能是 cannot_verify
  assert.equal(parsed.findings[1].verdict === "cannot_verify", false);
}

/** Prompt 要把三态讲清楚，模型才知道该报哪一种。 */
function testPromptAsksForVerdict() {
  const prompt = buildReviewPrompt({
    bookType: "student",
    moduleKey: "lets_read",
    moduleLabel: "Let's read",
    lessonNumber: 1,
    lessonTitle: "Fond memories",
    markdown: "正文",
    rules: [rule("ANSWER-001", { ruleType: "review" })],
  });
  assert.match(prompt, /verdict/);
  assert.match(prompt, /cannot_verify/);
  assert.match(prompt, /needs_revision/);
}

function testPromptKeepsRuleIds() {
  const rules = [
    rule("R-40", { isHard: true, instruction: "不得超纲", constraints: { min_words: 5 } }),
  ];
  const rendered = renderRules(rules);
  assert.match(rendered, /R-40/);
  assert.match(rendered, /红线/);
  assert.match(rendered, /min_words/);
  const prompt = buildReviewPrompt({
    bookType: "workbook",
    moduleKey: "day_1",
    moduleLabel: "Day 1",
    lessonNumber: 1,
    lessonTitle: "Fond memories",
    markdown: "正文",
    rules,
    outline: { coreVocabulary: "charm" },
  });
  assert.match(prompt, /R-40/, "规则 ID 必须进 Prompt，模型要按 ID 回报");
  assert.match(prompt, /不得超纲/);
  assert.match(prompt, /charm/);
  assert.match(prompt, /无法核查/, "要求模型在资料不足时明说，并标成 cannot_verify");
}

/**
 * 引文对不上要标出来（实测模型会报正文里并不存在的问题）。
 *
 * 判据是"给了引文但定位不到"——没给引文的（文档级问题）不算未核实，
 * 否则"大纲漏词"这类本来就无位置的结论会被误标。
 */
function testUnverifiedFlagRule() {
  const unverified = (originalText, markdown) =>
    originalText.trim() !== "" && locateQuote(markdown, originalText).blockIndex === null;
  assert.equal(unverified("正文里没有这句话", TARGET.markdown), true);
  assert.equal(unverified("1 Choose the correct word.", TARGET.markdown), false);
  // 没给引文的不算未核实：报"某处缺内容"的结论本来就没有可引的原文，
  // 一律标记会把真问题淹掉（实测"2c 没有练习内容"就是真问题）。
  assert.equal(unverified("", TARGET.markdown), false);
}

// ---------------------------------------------------------------------------
// 审校标准的元数据：执行方式、阶段、源行、判据
// ---------------------------------------------------------------------------

/**
 * 执行方式决定这条规则**怎么跑**（审校标准的 `execution_mode`）。
 *
 * 认不出的值退回 `hybrid`（确定性 + 模型），而不是当成"已按某方式跑过"——
 * 标准升版加了新的执行方式时，宁可退回默认路径，也不能假装覆盖。
 */
function testExecutionModeRouting() {
  const mode = (options) => executionModeOf(rule("X-1", options));
  assert.equal(mode({ payload: { executionMode: "human_visual" } }), "human_visual");
  assert.equal(mode({ payload: { executionMode: "source_lookup" } }), "source_lookup");
  assert.equal(mode({ payload: { executionMode: "deterministic_candidate" } }), "deterministic_candidate");
  assert.equal(mode({}), "hybrid", "没声明按默认路径");
  assert.equal(mode({ payload: { executionMode: "拿眼睛看" } }), "hybrid", "认不出的值退回默认");

  assert.equal(rulePhase(rule("X-2", { payload: { phase: "语言检查" } })), "语言检查");
  assert.equal(rulePhase(rule("X-3", { payload: { phase: "  " } })), null, "空白阶段不算阶段");
  assert.equal(rulePhase(rule("X-4", {})), null);
  assert.equal(rulePhase(null), null);

  // 判据与源行：去重、剔掉非字符串，供 Prompt 与报告使用
  const refs = standardRefsOf([
    rule("X-5", { payload: { standardRefs: ["references/a.md:1", "references/a.md:1", 7] } }),
    rule("X-6", { payload: { standardRefs: ["references/b.md:2"] } }),
    rule("X-7", {}),
  ]);
  assert.deepEqual(refs, ["references/a.md:1", "references/b.md:2"]);
  assert.deepEqual(reviewListRefsOf(rule("X-8", { payload: { reviewListRefs: ["SB03", "SB03"] } })), ["SB03"]);
  assert.deepEqual(reviewListRefsOf(null), []);
}

/**
 * 人工目视类规则**不假装跑过**：工作台审的是文字稿，没有成品页图与样式证据，
 * 按标准自己的 `cannot_verify` 语义如实标注，交老师目视。
 */
function testHumanVisualRulesAreReportedHonestly() {
  const rules = [
    rule("VIS-001", {
      isHard: true,
      ruleType: "review",
      displayName: "图文相符",
      payload: { executionMode: "human_visual", phase: "视觉检查" },
    }),
    rule("LANG-001", {
      ruleType: "review",
      payload: { executionMode: "model_assisted", phase: "语言检查" },
    }),
  ];
  const findings = humanVisualFindings(input(rules), TARGET, rules);
  assert.equal(findings.length, 1, "只有人工目视类规则产出这种 Finding");
  const [finding] = findings;
  assert.equal(finding.ruleKey, "VIS-001");
  assert.equal(finding.stage, "visual");
  assert.equal(finding.insufficientEvidence, true, "没有成品页证据 → 资料不足，不是「通过」");
  assert.equal(finding.phase, "视觉检查");
  assert.match(finding.message, /人工目视/);
  assert.deepEqual(finding.anchor, { quote: "", blockIndex: null }, "没有正文位置，不伪造");

  // 没有人工目视类规则时不产出噪声
  assert.deepEqual(humanVisualFindings(input([rules[1]]), TARGET, [rules[1]]), []);
}

const tests = [
  ["正文锚点（引文定位，找不到不猜）", testAnchor],
  ["按教材顺序排列结论", testMaterialOrder],
  ["执行方式路由与规则元数据", testExecutionModeRouting],
  ["人工目视类规则如实标注为待目视", testHumanVisualRulesAreReportedHonestly],
  ["审校侧排除生成时门禁约束", testConstraintFiltering],
  ["规则检查 → Finding", testRuleChecksBecomeFindings],
  ["来源门禁与来源标注的区别对待", testSourceGatesAreHandledCorrectly],
  ["大纲核心词汇覆盖检查", testCoverageFindings],
  ["聚合去重", testAggregate],
  ["统计", testSummarize],
  ["模型输出解析与兜底", testLlmParsing],
  ["三态结果：无法核查要结构化记下", testVerdictParsing],
  ["Prompt 说明三态取值", testPromptAsksForVerdict],
  ["Prompt 保留规则 ID 与约束", testPromptKeepsRuleIds],
  ["引文对不上标记为未核实", testUnverifiedFlagRule],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`审校 Pipeline 测试通过:${tests.length} 项`);
