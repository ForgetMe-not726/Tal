import assert from "node:assert/strict";
import TurndownService from "turndown";
import { normalizeRoundTripMarkdown } from "../lib/markdown/round-trip.ts";
import { normalizeModuleHeading } from "../lib/markdown/heading-levels.ts";

/**
 * 与 `components/workbench/EditableDocument.tsx` 同配置的最小 turndown。
 *
 * 这里**真的调 turndown**而不是手写转义字符串：这个 bug 的根因就是
 * 「turndown 的输出与生成结果不同形」，手写夹具会随着 turndown 升级而失真。
 * 表格规则与本测试无关，故不复制。
 */
function turndown(html) {
  return new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  }).turndown(html);
}

/** 编辑区的一次往返：渲染好的 DOM → Markdown → 清理。 */
function roundTrip(html) {
  return normalizeRoundTripMarkdown(turndown(html));
}

/**
 * 回归：带序号的模块标题往返后必须**逐字不变**。
 *
 * turndown 会把行首的「1. 」转义成「1\. 」（免得被当成有序列表），
 * 而模块标题恰好就是这种形式。后果有两个，实测都出现过：
 * 光点一下正文就变成「未保存修改」；下一次规范化认不出标题、**又插一行模块标题**。
 */
function testOrdinalHeadingSurvivesRoundTrip() {
  const generated = "# 1. Let's say!\n\n### 核心词汇\n\n正文";
  const html = "<h1>1. Let's say!</h1><h3>核心词汇</h3><p>正文</p>";

  // turndown 确实会加转义——这是前提，若哪天它不转了，本测试会提醒我们简化清理
  assert.match(turndown(html), /1\\\./, "turndown 应把序号里的点转义");

  const back = roundTrip(html);
  assert.equal(back, generated, "往返结果必须与生成结果逐字一致");
}

/** 回归：反复「选中模块」不能让开头越堆越多标题。 */
function testSelectingModuleRepeatedlyDoesNotStackHeadings() {
  // 模型直接从小节写起，规范化会补一行模块标题
  let markdown = normalizeModuleHeading("### 核心词汇\n\n正文", "1. Let's say!");
  assert.equal(markdown, "# 1. Let's say!\n\n### 核心词汇\n\n正文");

  // 模拟「编辑区渲染 → 失焦回写 → 再次选中渲染」重复 5 次
  for (let round = 0; round < 5; round += 1) {
    const html = markdown
      .split("\n\n")
      .map((block) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(block);
        if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
        return `<p>${block}</p>`;
      })
      .join("");
    markdown = normalizeModuleHeading(roundTrip(html), "1. Let's say!");
    assert.equal(markdown, "# 1. Let's say!\n\n### 核心词汇\n\n正文", `第 ${round + 1} 轮后标题被重复插入了`);
  }
}

/** 清理只动 turndown 的转义，不动正文里**字面**的下划线/星号。 */
function testCleanupLeavesLiteralContentAlone() {
  assert.equal(normalizeRoundTripMarkdown("# 1\\. Let's say!\n\n正文"), "# 1. Let's say!\n\n正文");
  // 行中的序号不是转义点，别乱改
  assert.equal(normalizeRoundTripMarkdown("第 1. 课"), "第 1. 课");
  // 正文里的转义是 turndown 对字面字符的保护，保持原样
  assert.equal(normalizeRoundTripMarkdown("a\\_b and c\\*d"), "a\\_b and c\\*d");
  // 排版痕迹照旧清理
  assert.equal(normalizeRoundTripMarkdown("正文\n\n\n\n正文  \n"), "正文\n\n正文");
}

/** 不带序号的模块标题（练习册的 `Day 1`）本来就没被转义，往返也要一致。 */
function testPlainHeadingSurvivesRoundTrip() {
  const generated = "# Day 1\n\n## Let's say!\n\n正文";
  assert.equal(roundTrip("<h1>Day 1</h1><h2>Let's say!</h2><p>正文</p>"), generated);
}

const tests = [
  ["带序号的模块标题往返后逐字不变（回归）", testOrdinalHeadingSurvivesRoundTrip],
  ["反复选中模块不会堆积标题（回归）", testSelectingModuleRepeatedlyDoesNotStackHeadings],
  ["清理只动转义、不动字面内容", testCleanupLeavesLiteralContentAlone],
  ["不带序号的标题往返一致", testPlainHeadingSurvivesRoundTrip],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`Markdown 往返测试通过:${tests.length} 项`);
