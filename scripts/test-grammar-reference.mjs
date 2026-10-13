import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  loadGrammarReference,
  renderGrammarBlock,
  resolveGrammarLabel,
} from "../lib/knowledge/grammar-reference.ts";

/**
 * 语法参考知识库的离线校验。
 *
 * 直接校验**仓库里的随包基线**（`resources/knowledge/grammar/`）——它才是发给老师的东西，
 * 完整性必须能被离线验证，不能依赖生成脚本跑过。
 */
const ROOT = "resources/knowledge/grammar";

function testIndexIsComplete() {
  assert.equal(existsSync(join(ROOT, "index.json")), true, "缺 index.json");
  const index = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));
  assert.equal(index.generator, "scripts/build-grammar-reference.mjs");
  assert.equal(index.points.length, 22, "GR01–GR22 都要在");
  for (const point of index.points) {
    assert.match(point.id, /^GR\d{2}$/);
    assert.ok(point.topic, `${point.id} 缺主题`);
    assert.equal(existsSync(join(ROOT, point.file)), true, `${point.id} 的文件不在：${point.file}`);
    assert.ok(point.sources.length > 0, `${point.id} 没有来源标注`);
    // 来源必须带页码，否则回不到书上
    for (const source of point.sources) {
      assert.match(source, /p\.\d+/u, `${point.id} 的来源没有页码：${source}`);
    }
  }
  // 索引里的文件名要和磁盘上的一致（不留孤儿文件）
  const onDisk = new Set(readdirSync(ROOT).filter((name) => name.endsWith(".md")));
  for (const point of index.points) assert.equal(onDisk.has(point.file), true);
  assert.equal(onDisk.size, index.points.length + 1, "除 README.md 外不该有多余文件");
}

/** 每个语法点都要有实质内容，不能是空壳。 */
function testPointsHaveSubstance() {
  const index = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));
  for (const point of index.points) {
    const text = readFileSync(join(ROOT, point.file), "utf8");
    assert.ok(text.length > 2000, `${point.id} 内容太薄（${text.length} 字符）`);
    // 页眉页脚、纯页码、练习页残留要清干净
    assert.doesNotMatch(text, /^Exercises\s*$/mu, `${point.id} 混进了练习页`);
    assert.doesNotMatch(text, /^\d{1,4}$/mu, `${point.id} 混进了裸页码`);
  }
}

/** 大纲写法 → 语法点：按最长命中，认不出不猜。 */
function testLabelResolution() {
  const labels = {
    比较级: "GR04",
    同级比较: "GR04",
    反义疑问句: "GR11",
    反身代词: "GR03",
  };
  assert.deepEqual(resolveGrammarLabel(labels, "反义疑问句"), { id: "GR11", label: "反义疑问句" });
  // 最长命中优先：不能因为"比较级"更靠前就把"同级比较"抢走
  assert.equal(resolveGrammarLabel(labels, "同级比较：as...as")?.label, "同级比较");
  assert.equal(resolveGrammarLabel(labels, "形容词、副词的比较级和最高级")?.id, "GR04");
  // 认不出就返回 null，不猜
  assert.equal(resolveGrammarLabel(labels, "虚拟语气的省略"), null);
  assert.equal(resolveGrammarLabel(labels, ""), null);
  assert.equal(resolveGrammarLabel(labels, null), null);
  assert.equal(resolveGrammarLabel(labels, undefined), null);
}

/** 取用：命中就带上来源与正文；预算超了如实截断。 */
async function testLoadReference() {
  const hit = await loadGrammarReference({ grammar: "反义疑问句", root: ROOT });
  assert.ok(hit, "「反义疑问句」应当取到参考");
  assert.equal(hit.pointId, "GR11");
  assert.equal(hit.label, "反义疑问句");
  assert.ok(hit.sources.length > 0);
  assert.match(hit.text, /# GR11/);
  assert.equal(hit.truncated, false);

  // 大纲里写成多行也要认得
  const multiline = await loadGrammarReference({
    grammar: "形容词、副词的比较级和最高级\n同级比较：as...as\n修饰比较级的限定词：much, a lot",
    root: ROOT,
  });
  assert.equal(multiline?.pointId, "GR04");

  // 预算：超了就截断，并说明完整内容在哪
  const capped = await loadGrammarReference({ grammar: "反义疑问句", maxChars: 1000, root: ROOT });
  assert.equal(capped?.truncated, true);
  assert.ok(capped.text.length < 1400);
  assert.match(capped.text, /超出预算/);
}

/** 取不到时如实返回 null，不假装有。 */
async function testMissingIsHonest() {
  assert.equal(await loadGrammarReference({ grammar: "反义疑问句", root: "没有这个目录" }), null);
  assert.equal(await loadGrammarReference({ grammar: "大纲里没写过的语法", root: ROOT }), null);
  assert.equal(await loadGrammarReference({ grammar: null, root: ROOT }), null);
  assert.equal(await loadGrammarReference({ grammar: "   ", root: ROOT }), null);
}

/**
 * 生成 Prompt 里的语法段：取到就带正文与来源；取不到**明说没有**，不是留空——
 * 留空会让模型拿自己的印象补语法规则。
 */
async function testPromptBlock() {
  const reference = await loadGrammarReference({ grammar: "反义疑问句", root: ROOT });
  const block = renderGrammarBlock(reference);
  assert.match(block, /反义疑问句/);
  assert.match(block, /GR11/);
  assert.match(block, /来源：.*p\.\d+/u, "要带页码，否则回不到书上");
  assert.ok(block.length > 1000, "正文要真的带进来");

  const empty = renderGrammarBlock(null);
  assert.match(empty, /没有对应的语法参考/);
  assert.match(empty, /以大纲为准/);
  assert.doesNotMatch(empty, /GR\d/);
}

const tests = [
  ["索引完整：22 个语法点、文件都在、来源带页码", testIndexIsComplete],
  ["每个语法点都有实质内容且清干净了", testPointsHaveSubstance],
  ["大纲写法按最长命中解析，认不出不猜", testLabelResolution],
  ["按语法点取用参考，预算超了如实截断", testLoadReference],
  ["取不到时如实返回 null", testMissingIsHonest],
  ["生成 Prompt 的语法段：取到带来源，取不到明说", testPromptBlock],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`语法参考知识库测试通过:${tests.length} 项`);
