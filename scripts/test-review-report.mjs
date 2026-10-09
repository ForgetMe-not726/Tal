import assert from "node:assert/strict";
import { buildReviewReport, escapeHtml } from "../lib/review/report.ts";

/** 造一份 manifest + findings，字段里故意塞进危险内容。 */
function manifest(overrides = {}) {
  return {
    jobId: "j1",
    projectId: "p1",
    lessonNumber: 1,
    lessonTitle: "Fond memories",
    lessonType: "regular",
    scope: "module",
    bookType: "workbook",
    status: "ready",
    inputs: [
      { bookType: "workbook", moduleId: "m-1", moduleKey: "day_1", moduleLabel: "Day 1", versionId: "v1", versionNumber: 2 },
    ],
    rules: {
      snapshotVersion: null,
      resolvedAt: "2026-10-08T10:00:00.000Z",
      entries: [{ ruleKey: "R-WB-004", ruleType: "review", isHard: false, versionNumber: 1, scope: "global" }],
      excluded: [{ ruleKey: "require_confirmed_source", reason: "生成时门禁" }],
    },
    sources: ["legacy-wb:lesson-1:say"],
    pipeline: [
      { name: "rule_checks", status: "ok", findingCount: 2 },
      { name: "cambridge", status: "skipped", findingCount: 0, note: "工作区里还没有剑桥参考资料" },
    ],
    engine: { provider: "openai-compatible", model: "gpt-x" },
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:05:00.000Z",
    reportGeneratedAt: "2026-10-08T10:06:00.000Z",
    stats: {
      total: 2,
      byStatus: { pending: 1, adopt: 1, ignore: 0, recheck: 0 },
      byBook: { workbook: 2 },
      insufficientEvidence: 0,
    },
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    id: "F-1",
    ruleKey: "R-WB-004",
    ruleType: "review",
    stage: "rule_checks",
    bookType: "workbook",
    moduleKey: "day_1",
    moduleLabel: "Day 1",
    lessonNumber: 1,
    lessonType: "regular",
    versionId: "v1",
    versionNumber: 2,
    anchor: { quote: "普通引文", blockIndex: 1 },
    message: "普通问题",
    ...overrides,
  };
}

/** 转义本身：五个字符一个不漏。 */
function testEscape() {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml('a & b "c" \'d\''), "a &amp; b &quot;c&quot; &#39;d&#39;");
  assert.equal(escapeHtml("正常中文"), "正常中文");
}

/**
 * 回归（安全）：报告里**任何**动态内容都必须转义。
 *
 * 教材片段、模型输出、老师备注都来自模型或人，可能带标签；报告是只读展示物，
 * 一旦不转义就变成可执行页面（`docs/REVIEW-SKILL-INTEGRATION.md` §6 的硬要求）。
 */
function testDangerousContentIsEscaped() {
  const html = buildReviewReport(
    manifest({
      lessonTitle: '<img src=x onerror="alert(1)">',
      inputs: [
        {
          bookType: "workbook",
          moduleId: "m-1",
          moduleKey: "day_1",
          moduleLabel: "<script>alert('label')</script>",
          versionId: "v1",
          versionNumber: 2,
        },
      ],
      sources: ['<a href="javascript:alert(1)">来源</a>'],
      pipeline: [
        { name: "rule_checks", status: "ok", findingCount: 1, note: "<script>note</script>" },
      ],
    }),
    [
      finding({
        anchor: { quote: "<script>alert('quote')</script>", blockIndex: 1 },
        message: "<script>alert('message')</script>",
        evidence: '<iframe src="evil"></iframe>',
        suggestion: '"><img src=x onerror=alert(1)>',
        decision: {
          action: "adopt",
          note: "<b>备注</b>",
          decidedAt: "2026-10-08T10:10:00.000Z",
          decidedBy: "teacher",
        },
      }),
    ],
  );

  // 真正的判据：报告里的**每一个标签**都必须来自模板白名单。
  // 只查"有没有 <script"不够——`onerror=` 作为转义后的文本是无害的，
  // 而只要它出现在真标签里就危险。逐标签核对才是可判定的。
  const ALLOWED = new Set([
    "!doctype", "html", "head", "meta", "title", "style", "body", "div",
    "h1", "h2", "h3", "p", "span", "table", "thead", "tbody", "tr", "th", "td",
    "article", "header", "section", "ul", "li", "code", "strong", "br",
  ]);
  const tags = [...html.matchAll(/<\/?([a-zA-Z!][a-zA-Z0-9-]*)/g)].map((match) =>
    match[1].toLowerCase(),
  );
  for (const tag of tags) {
    assert.equal(ALLOWED.has(tag), true, `报告里出现了模板之外的标签：<${tag}>`);
  }
  // 转义后的形态要在（说明内容确实进报告了，不是被丢掉）
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  // 不引用任何远程资源
  assert.doesNotMatch(html, /src\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /src\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /<link\b/i);
}

/** 报告要包含契约要求的六项内容。 */
function testReportSections() {
  const html = buildReviewReport(manifest(), [
    finding({
      id: "F-1",
      message: "阻断问题",
      decision: { action: "adopt", decidedAt: "2026-10-08T10:10:00.000Z", decidedBy: "teacher" },
    }),
    finding({
      id: "F-2",
      message: "资料不足的问题",
      insufficientEvidence: true,
    }),
    finding({
      id: "F-3",
        message: "引文对不上的问题",
      unverified: true,
      // 审校标准自己的环节：报告里必须与 Pipeline 的「阶段」区分开
      phase: "language",
    }),
  ]);
  assert.match(html, /审校范围与输入版本/);
  assert.match(html, /规则、来源与执行情况/);
  assert.match(html, /问题汇总/);
  assert.match(html, /逐条问题/);
  assert.match(html, /资料不足与未完成复核/);
  assert.match(html, /必须人工复核/);
  // 输入版本与规则要写清楚
  assert.match(html, /Day 1/);
  assert.match(html, /R-WB-004/);
  assert.match(html, /未执行的约束/);
  // 阶段如实呈现：跳过的阶段带原因
  assert.match(html, /未执行/);
  assert.match(html, /工作区里还没有剑桥参考资料/);
  // 统计与资料不足清单
  assert.match(html, /阻断/);
  assert.match(html, /资料不足的问题/);
  assert.match(html, /没有能在正文里定位到的依据/, "未经核实的结论要在报告里标明");
  // 标准环节与 Pipeline 阶段是两套词，报告里要分得清
  assert.match(html, /标准环节 language/);
  // 不给结论评严重度（审校标准明确不新增严重度字段）：汇总按条数与处理状态给
  assert.doesNotMatch(html, /严重度/);
  assert.match(html, /共 3 条结论/, "报告内部的数字只从 findings 推");
  assert.match(html, /资料不足 1 条/);
  assert.match(html, /还有 2 条问题没有人工处理/, "三条里有一条已处理");
}

/** 没有 Finding 时也要是一份完整报告，不出现空模板。 */
function testEmptyReport() {
  const html = buildReviewReport(manifest({ stats: { total: 0, byStatus: { pending: 0, adopt: 0, ignore: 0, recheck: 0 }, byBook: {}, insufficientEvidence: 0 } }), []);
  assert.match(html, /本次审校没有发现问题/);
  assert.match(html, /所有问题都已人工处理/);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<\/html>/);
}

/** 模型输出可以很长，但不能把标签结构带进来。 */
function testModelTextCannotBreakStructure() {
  const html = buildReviewReport(manifest(), [
    finding({ message: "</article></section><script>alert(1)</script><section>" }),
  ]);
  assert.equal(html.includes("<script"), false);
  // article 的开闭数量仍然配平
  const opens = (html.match(/<article/g) ?? []).length;
  const closes = (html.match(/<\/article>/g) ?? []).length;
  assert.equal(opens, closes);
}

const tests = [
  ["HTML 转义", testEscape],
  ["危险内容必须被转义（安全回归）", testDangerousContentIsEscaped],
  ["报告包含契约要求的六项", testReportSections],
  ["没有 Finding 时仍是完整报告", testEmptyReport],
  ["模型文本无法破坏标签结构", testModelTextCannotBreakStructure],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`审校报告测试通过:${tests.length} 项`);
