import assert from "node:assert/strict";
import { searchCorpora } from "../lib/assistant/match.ts";
import { extractKeywords, validatePlan } from "../lib/assistant/plan.ts";
import { SOURCE_KIND_LABEL } from "../lib/assistant/types.ts";

/**
 * 通用助手的检索契约（`docs/AI-ASSISTANT-RETRIEVAL.md` §4）。
 *
 * 只测**纯函数**部分（语料已收集之后的匹配与排序、查询计划校验）：
 * 这两块决定"结果里有什么、按什么排、模型给的过滤条件认不认"，是最容易悄悄错的地方。
 * 真实工作区上的端到端检索由集成复核覆盖。
 */

const DATE = "2026-10-01T00:00:00.000Z";

function entry(overrides = {}) {
  return {
    id: overrides.source_ref ?? "e1",
    layer: "production_source",
    entry_type: "module_text",
    title: "Let's say! 核心词汇",
    content: "Whitebridge is a charming village. environment 环境",
    payload: { source_status: "confirmed", source_document: "寒假学生用书.pdf", page: 12 },
    project_id: "p1",
    grade: "L5",
    lesson_id: "l1",
    book_type: "student",
    module_key: "lets_say",
    source_module_id: "s1",
    source_ref: "manual:aaa",
    created_at: DATE,
    ...overrides,
  };
}

function corpora(overrides = {}) {
  return {
    projects: [{ id: "p1", name: "P", grade: "L5", term: "winter" }],
    lessons: [
      { projectId: "p1", lesson: { id: "l1", project_id: "p1", lesson_number: 1, title: "Fond memories", lesson_type: "regular", status: "not_started", created_at: DATE, updated_at: DATE } },
      { projectId: "p1", lesson: { id: "l2", project_id: "p1", lesson_number: 2, title: "Shopping", lesson_type: "regular", status: "not_started", created_at: DATE, updated_at: DATE } },
    ],
    entries: [entry()],
    rules: [
      { ruleKey: "LANG-001", displayName: "当代标准英式英语", description: "", instruction: "逐词核对英式拼写：colour, centre。", scope: "global" },
    ],
    versions: [
      { bookType: "student", moduleKey: "lets_say", moduleLabel: "Let's say!", versionNumber: 2, lessonNumber: 1, markdown: "## Let's say!\n\n核心词汇 environment 出现一次。" },
    ],
    references: [{ name: "GR11-疑问句与附加问句", text: "# GR11\n\nquestion tag 反义疑问句的用法。" }],
    ...overrides,
  };
}

/** 命中要带齐契约字段：稳定引用、来源定位、状态、页图定位。 */
function testHitCarriesContract() {
  const result = searchCorpora(corpora(), { query: "environment", scope: "workspace" });
  assert.equal(result.hits.length > 0, true, "应当命中");
  const hit = result.hits.find((item) => item.kind === "source");
  assert.ok(hit, "要有来源命中");
  assert.equal(hit.sourceRef, "manual:aaa");
  assert.equal(hit.documentName, "寒假学生用书.pdf");
  assert.equal(hit.bookType, "student");
  assert.equal(hit.moduleKey, "lets_say");
  assert.equal(hit.pageIndex, 11, "页码 0 起（payload.page - 1）");
  assert.equal(hit.status, "confirmed");
  assert.equal(typeof hit.score, "number");
  assert.ok(hit.snippet.includes("environment"));
  // 每条命中都要有可显示的来源定位
  for (const item of result.hits) {
    assert.ok(item.sourceRef, "命中必须带稳定引用");
    assert.ok(SOURCE_KIND_LABEL[item.kind], `未知的来源类型：${item.kind}`);
  }
}

/** 未确认来源**要返回**但标成待核对：§6 要求"可供查看，但不能当 Production Source"。 */
function testUnconfirmedIsReturnedAndMarked() {
  const result = searchCorpora(
    corpora({ entries: [entry({ payload: { source_status: "pending", source_document: "寒假学生用书.pdf", page: 3 } })] }),
    { query: "environment", scope: "workspace" },
  );
  const hit = result.hits.find((item) => item.kind === "source");
  assert.ok(hit, "待核对的来源也要能被搜到");
  assert.equal(hit.status, "pending");
}

/** 英文词卡词边界：`tag` 不该命中 cottage / stage。 */
function testEnglishKeywordsRespectWordBoundaries() {
  const result = searchCorpora(
    corpora({
      entries: [entry({ title: "乡村生活", content: "a small cottage with a wide stage and an advantage", source_ref: "manual:bbb" })],
    }),
    { query: "tag", scope: "workspace" },
  );
  assert.deepEqual(result.hits.filter((item) => item.kind === "source"), [], "tag 不该命中 cottage/stage/advantage");
  // 真正的词要命中
  const real = searchCorpora(
    corpora({ entries: [entry({ title: "附加问句", content: "a question tag is added", source_ref: "manual:ccc" })] }),
    { query: "tag", scope: "workspace" },
  );
  assert.equal(real.hits.some((item) => item.kind === "source"), true);
}

/** 过滤条件生效：书种 / Lesson / 模块 / 来源类型。 */
function testFilters() {
  const data = corpora();
  assert.equal(searchCorpora(data, { query: "environment", scope: "workspace", bookType: "workbook" }).hits.length, 0);
  assert.equal(searchCorpora(data, { query: "environment", scope: "workspace", bookType: "student" }).hits.length > 0, true);
  assert.equal(searchCorpora(data, { query: "environment", scope: "workspace", moduleKey: "lets_read" }).hits.length, 0);
  assert.equal(searchCorpora(data, { query: "environment", scope: "workspace", lessonNumber: 2 }).hits.length, 0);
  assert.equal(searchCorpora(data, { query: "environment", scope: "workspace", lessonNumber: 1 }).hits.length > 0, true);
  // 只搜规则时，来源命中不该出现
  const rulesOnly = searchCorpora(data, { query: "colour", scope: "workspace", sourceKind: "rule" });
  assert.equal(rulesOnly.hits.every((item) => item.kind === "rule"), true);
}

/** limit 生效；无命中时返回空 + 已搜索范围（§6 要求说明搜过什么）。 */
function testLimitAndEmpty() {
  const many = searchCorpora(corpora(), { query: "environment", scope: "workspace", limit: 1 });
  assert.equal(many.hits.length, 1);

  const empty = searchCorpora(corpora(), { query: "zzzqqq", scope: "workspace" });
  assert.deepEqual(empty.hits, []);
  assert.equal(empty.searched.projects, 1);
  assert.equal(empty.searched.lessons, 2);
  assert.equal(empty.searched.entries, 1);
  assert.deepEqual(empty.searched.keywords, ["zzzqqq"]);
}

/** 单字关键词不参与检索（否则"的""了"会命中一切）。 */
function testShortKeywordsIgnored() {
  const result = searchCorpora(corpora(), { query: "的 了 a", scope: "workspace" });
  assert.deepEqual(result.searched.keywords, []);
  assert.deepEqual(result.hits, []);
}

// ---------------------------------------------------------------------------
// 查询计划
// ---------------------------------------------------------------------------

/** 模型给的过滤条件只能用它认识的值，认不出的丢掉并如实报告。 */
function testPlanValidation() {
  const context = {
    known: { bookTypes: ["student", "workbook"], lessonNumbers: [1, 2], moduleKeys: ["lets_say", "lets_read"] },
    aiAvailable: true,
  };
  const ok = validatePlan(
    { keywords: ["Environment", "environment"], bookType: "student", lessonNumber: 1, moduleKey: "lets_say", sourceKind: "source" },
    context,
  );
  assert.deepEqual(ok.keywords, ["environment"], "关键词要去重并统一小写");
  assert.equal(ok.bookType, "student");
  assert.equal(ok.lessonNumber, 1);
  assert.equal(ok.moduleKey, "lets_say");
  assert.equal(ok.sourceKind, "source");
  assert.deepEqual(ok.dropped, []);

  // 不存在的值一律丢掉，并告诉老师丢了什么
  const bad = validatePlan(
    { keywords: ["x"], bookType: "绘本", lessonNumber: 99, moduleKey: "不存在的模块", sourceKind: "聊天" },
    context,
  );
  assert.equal(bad.bookType, undefined);
  assert.equal(bad.lessonNumber, undefined);
  assert.equal(bad.moduleKey, undefined);
  assert.equal(bad.sourceKind, undefined);
  assert.equal(bad.dropped.length, 4, "四个认不出的条件都要报出来");
}

/** 退回关键词直检：去掉"查找""包含"这类功能词，不留单字。 */
function testKeywordFallback() {
  assert.deepEqual(extractKeywords("environment"), ["environment"]);
  const mixed = extractKeywords("查找 Let's say 中的 environment");
  assert.equal(mixed.includes("environment"), true);
  assert.equal(mixed.includes("查找"), false, "功能词不该当检索词");
  assert.equal(mixed.some((word) => word.length < 2), false, "不留单字");
  // 整句中文没有空格时也要能退出来
  assert.equal(extractKeywords("查找反义疑问句").length > 0, true);
}

const tests = [
  ["命中带齐契约字段（引用/定位/状态/页图）", testHitCarriesContract],
  ["待核对来源返回并标状态", testUnconfirmedIsReturnedAndMarked],
  ["英文关键词卡词边界", testEnglishKeywordsRespectWordBoundaries],
  ["书种/Lesson/模块/来源类型过滤生效", testFilters],
  ["limit 生效、无命中给已搜索范围", testLimitAndEmpty],
  ["单字不参与检索", testShortKeywordsIgnored],
  ["查询计划：认不出的条件丢掉并报告", testPlanValidation],
  ["AI 不可用时退回关键词直检", testKeywordFallback],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`通用助手检索测试通过:${tests.length} 项`);
