import assert from "node:assert/strict";
import {
  checkEnglishOnly,
  checkVocabularyCoverage,
  findMissingVocabulary,
  parseVocabularyList,
} from "../lib/generation/coverage.ts";

/** 大纲的真实写法：带数量标注 + 换行 + 逗号分隔。 */
const OUTLINE_VALUE =
  "核心词汇数量：15个\ncharm, inhabitant, rural, generosity, feast, authentic, memorable, " +
  "densely populated, vast, itinerary, fond, hospitality, first-rate, convenience, distinctive";

/**
 * 实测的丢失案例：模型漏掉了 `densely populated` 与 `first-rate`，
 * 而源里这两个词是完整的。这个检查就是为了让这种丢失不再静默。
 */
const GENERATED_MISSING_TWO = [
  "## Let's say!",
  "",
  "| 难度 | 词汇 | 音标 | 词性和含义 |",
  "| --- | --- | --- | --- |",
  "| B2 | charm | [tʃa:m] | n. 魅力 |",
  "| B2 | inhabitant | [ın'hæb] | n. 居民 |",
  "| B2 | rural | ['ruə.rəl] | adj. 乡村的 |",
  "| B2 | generosity | [dʒen] | n. 慷慨 |",
  "| B2 | feast | [fi:st] | n. 盛宴 |",
  "| B2 | authentic | [ɔ:'θentɪk] | adj. 真正的 |",
  "| B2 | memorable | ['memərəbl] | adj. 难忘的 |",
  "| B2 | vast | [vɑ:st] | adj. 巨大的 |",
  "| B2 | itinerary | [aɪ'tɪnərəri] | n. 旅行计划 |",
  "| B2 | fond | [fɒnd] | adj. 喜爱的 |",
  "| B2 | hospitality | [hɒspɪ'tæləti] | n. 好客 |",
  "| B2 | convenience | [kən'vi:niəns] | n. 方便 |",
  "| B2 | distinctive | [dɪ'stɪŋktɪv] | adj. 独特的 |",
].join("\n");

function testParseVocabularyList() {
  const words = parseVocabularyList(OUTLINE_VALUE);
  assert.equal(words.length, 15, "数量标注要去掉，不能当成一个词");
  assert.equal(words[0], "charm");
  assert.equal(words.includes("densely populated"), true, "带空格的词组要保留完整");
  assert.equal(words.includes("first-rate"), true, "带连字符的词要保留完整");
  // 空值与噪声
  assert.deepEqual(parseVocabularyList(null), []);
  assert.deepEqual(parseVocabularyList(""), []);
  assert.deepEqual(parseVocabularyList("核心词汇数量：0个"), []);
  // 各种分隔符
  assert.deepEqual(parseVocabularyList("a、b；c，d\ne"), ["a", "b", "c", "d", "e"]);
}

function testCatchesTheRealLoss() {
  const issues = checkVocabularyCoverage(GENERATED_MISSING_TWO, OUTLINE_VALUE);
  assert.equal(issues.length, 1, "漏词必须报出来");
  const issue = issues[0];
  assert.equal(issue.ruleKey, "builtin:core_vocabulary");
  assert.match(issue.message, /densely populated/);
  assert.match(issue.message, /first-rate/);
  assert.match(issue.message, /15 个核心词汇里有 2 个/, "要说清漏了几个");
  assert.equal(issue.evidence, "densely populated、first-rate");
  // 已知项不能算漏
  assert.deepEqual(issue.actual.includes("charm"), true);
}

function testPassesWhenComplete() {
  const complete = `${GENERATED_MISSING_TWO}\n\n| B2 | densely populated | [densli] | adj. 人口稠密的 |\n| B2 | first-rate | [f3:st] | adj. 一流的 |`;
  assert.deepEqual(checkVocabularyCoverage(complete, OUTLINE_VALUE), []);
}

/** 没有大纲词汇时不该报错（例如课时目标这类不依赖词汇的模块）。 */
function testNoVocabularyMeansNoIssue() {
  assert.deepEqual(checkVocabularyCoverage("任意正文", null), []);
  assert.deepEqual(checkVocabularyCoverage("任意正文", ""), []);
  assert.deepEqual(checkVocabularyCoverage("任意正文", "核心词汇数量：0个"), []);
}

/** 匹配不区分大小写与首尾空白。 */
function testMatchingIsForgiving() {
  assert.deepEqual(findMissingVocabulary("charm and CHARM", ["charm"]), []);
  assert.deepEqual(findMissingVocabulary("text", ["  charm  "]), ["  charm  "]);
  assert.deepEqual(findMissingVocabulary("", ["charm"]), ["charm"]);
}

/**
 * 回归（实测）：大纲里的词可能用**不间断空格**，正文里是普通空格。
 *
 * 实测寒假大纲 Lesson 1 的核心词汇 `densely populated` 用的是 U+00A0，
 * 而正文里是普通空格——直接 `includes` 会把它报成"漏词"，
 * 老师会去补一个根本没丢的词。比对前必须统一空白。
 */
function testNonBreakingSpaceIsNotAMissingWord() {
  // 用 fromCharCode 写出 NBSP：让这一段的意图在源码里一眼可见，
  // 也不至于让编辑器把不可见字符混进字符串里。
  const nbsp = String.fromCharCode(0xa0);
  const outline = `核心词汇数量：2个
charm, densely${nbsp}populated`;
  const generated = "charm is a nice word, and this is a densely populated area.";
  assert.deepEqual(checkVocabularyCoverage(generated, outline), [], "不间断空格不该判成漏词");

  // 反方向：正文里是 NBSP、大纲里是普通空格
  assert.deepEqual(
    checkVocabularyCoverage(`charm in a densely${nbsp}populated area`, "charm, densely populated"),
    [],
  );
  // 多余空格同理
  assert.deepEqual(checkVocabularyCoverage("densely   populated", "densely populated"), []);
  // 真的没写还是要报
  const issues = checkVocabularyCoverage("charm is here", "charm, densely populated");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /densely populated/);
}

/** 学生用书/练习册是英文书；知识清单是中文，不检查。 */
function testEnglishOnly() {
  assert.equal(checkEnglishOnly("In this lesson, we will...", "student").length, 0);
  const issues = checkEnglishOnly(
    ["## 并列句与逻辑连词", "- learn words about weather."].join(String.fromCharCode(10)),
    "student",
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /并列句与逻辑连词/);
  assert.equal(
    checkEnglishOnly(["## 学习目标", "| 目标词汇 | x |"].join(String.fromCharCode(10)), "knowledge").length,
    0,
  );
  assert.equal(checkEnglishOnly("中文", "workbook").length, 1);
}

const tests = [
  ["解析大纲词汇列表", testParseVocabularyList],
  ["抓出实测的漏词（回归）", testCatchesTheRealLoss],
  ["词汇齐全时不报", testPassesWhenComplete],
  ["无大纲词汇时不报", testNoVocabularyMeansNoIssue],
  ["匹配容错", testMatchingIsForgiving],
  ["不间断空格不算漏词（回归）", testNonBreakingSpaceIsNotAMissingWord],
  ["英文书种不出现中文", testEnglishOnly],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`迁移覆盖检查测试通过:${tests.length} 项`);
