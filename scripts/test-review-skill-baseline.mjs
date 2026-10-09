import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  parseStandardRef,
  parseStandardSections,
  selectStandardSections,
  standardFilesOf,
  standardTableOfContents,
} from "../lib/review/standards.ts";

/**
 * 随包基线的自检。
 *
 * 转换脚本自己有断言（`convert-review-skill.mjs --check`），但那需要 Skill 源目录
 * （在开发机之外不存在）。这里检的是**已经落在仓库里的基线**——它才是随包分发的东西，
 * 完整性必须能被离线验证。
 */
const RULES_DIR = "resources/rules";
const STANDARDS_DIR = "resources/knowledge/review-standards";

/** 审校标准迁移来的规则：id 形如 `LANG-001`（不是本项目的 `R-XX-NNN`）。 */
const SKILL_RULE_IDS = readdirSync(RULES_DIR).filter((name) => /^[A-Z][A-Z0-9]{1,15}-[0-9]{3}$/u.test(name));

function readRule(id) {
  return JSON.parse(readFileSync(join(RULES_DIR, id, "rule.json"), "utf8"));
}

function testBaselineRulesAreComplete() {
  assert.equal(SKILL_RULE_IDS.length, 24, "审校标准的规则应全部落进基线");
  const keys = SKILL_RULE_IDS.map((id) => readRule(id).rule_key);
  assert.equal(new Set(keys).size, keys.length, "规则 id 不能重复");
  for (const id of SKILL_RULE_IDS) {
    const row = readRule(id);
    assert.equal(row.rule_key, id);
    assert.equal(row.rule_type, "review", "迁移来的规则都是审校规则");
    assert.equal(typeof row.is_hard, "boolean");
    // 元数据必须齐：阶段、执行方式、源行映射、判据引用、来源
    assert.ok(row.payload?.phase, `${id} 缺 phase`);
    assert.ok(row.payload?.executionMode, `${id} 缺 executionMode`);
    assert.ok(Array.isArray(row.payload?.reviewListRefs), `${id} 缺 reviewListRefs`);
    assert.ok((row.payload?.standardRefs ?? []).length > 0, `${id} 缺判据引用`);
    assert.match(row.payload?.sourceSkillRef ?? "", /pet-material-review v\d+\.\d+\.\d+#/, `${id} 缺来源引用`);
    // 版本与绑定
    const version = JSON.parse(readFileSync(join(RULES_DIR, id, "versions", "1.json"), "utf8"));
    assert.equal(version.status, "published", "基线规则必须是已发布版本");
    assert.ok(version.instruction.length > 40, `${id} 的指令太短`);
    const bindings = JSON.parse(readFileSync(join(RULES_DIR, id, "bindings.json"), "utf8"));
    assert.ok(bindings.length > 0, `${id} 缺绑定`);
  }
}

/** 标准的契约要求：38 个教材源行 + 2 个全书门控都要被规则映射到。 */
function testSourceLinesAreCovered() {
  const covered = new Set(
    SKILL_RULE_IDS.flatMap((id) => readRule(id).payload.reviewListRefs ?? []),
  );
  const reviewList = readFileSync(join(STANDARDS_DIR, "review-list.md"), "utf8");
  const declared = [...reviewList.matchAll(/^###\s+((?:SB|WB|VS|KL)\d{2})\b/gm)].map(
    (match) => match[1],
  );
  assert.equal(declared.length, 38, "审校清单应有 38 个教材源行");
  const missing = [...declared, "GLOBAL-FACTS", "GLOBAL-BRITISH"].filter((ref) => !covered.has(ref));
  assert.deepEqual(missing, [], `有源行没被任何规则覆盖：${missing.join("、")}`);
}

/**
 * 判据材料要随包在，而且**每条引用都有落点**。
 *
 * 落点有两级：能对到具体小节最好；对不上（标准里有些引用写的是"讲了什么"而不是标题，
 * 如 `delivery-and-sources.md:视觉三轮`）就退到该材料的目录。
 * 但**不能有既取不到小节、又给不出目录的引用**——那等于这条规则的判据没读。
 */
function testStandardsArePresentAndResolvable() {
  for (const file of [
    "SKILL.md",
    "review-list.md",
    "review-standards.md",
    "grammar-review.md",
    "delivery-and-sources.md",
    "b1-vocabulary-index.tsv",
  ]) {
    assert.equal(existsSync(join(STANDARDS_DIR, file)), true, `判据材料缺 ${file}`);
  }

  const refs = SKILL_RULE_IDS.flatMap((id) => readRule(id).payload.standardRefs ?? []);
  const files = standardFilesOf(refs);
  assert.equal(files.length > 0, true);
  // 引用的文件必须都随包在（取不到文件就没得谈）
  for (const file of files) {
    assert.equal(existsSync(join(STANDARDS_DIR, basename(file))), true, `引用指向的材料不在包里：${file}`);
  }

  const sections = files.flatMap((file) =>
    parseStandardSections(readFileSync(join(STANDARDS_DIR, basename(file)), "utf8"), file),
  );
  const picked = selectStandardSections(refs, sections);
  const toc = standardTableOfContents(refs, sections);
  const tocFiles = new Set(toc.map((item) => item.file));
  const unresolved = [];
  for (const id of SKILL_RULE_IDS) {
    for (const ref of readRule(id).payload.standardRefs ?? []) {
      const parsed = parseStandardRef(ref);
      assert.ok(parsed, `引用写不出文件与小节：${id} → ${ref}`);
      const file = `references/${basename(parsed.file)}`;
      if (selectStandardSections([ref], sections).length === 0 && !tocFiles.has(file)) {
        unresolved.push(`${id} → ${ref}`);
      }
    }
  }
  assert.deepEqual(unresolved, [], `有判据引用既取不到小节、也拿不到目录：${unresolved.join("；")}`);
  assert.equal(picked.length > 0, true);
  // 目录是兜底，不是常态：精确取到的引用应当占多数。数的是**引用**不是去重后的小节
  // （多条规则引用同一小节是正常的，去重后的数量会小于引用数）。
  const exact = refs.filter((ref) => selectStandardSections([ref], sections).length > 0).length;
  console.log(`  · 判据引用 ${refs.length} 条：精确取到小节 ${exact} 条，退到目录 ${refs.length - exact} 条`);
  assert.ok(
    exact >= refs.length / 2,
    `精确取到的引用太少（${exact}/${refs.length}）——引用写法与材料标题可能大面积对不上`,
  );
}

/** 判据取用是**精确**的：不能把 `7` 取成标题里含 7 的 `5.7`。 */
function testSelectionIsExact() {
  const sections = [
    { file: "references/review-standards.md", label: "5.7", title: "5.7 某小节", content: "内容" },
    { file: "references/review-standards.md", label: "7", title: "7. 难度", content: "难度内容" },
    { file: "references/grammar-review.md", label: "4", title: "4. 通用语法审校门槛", content: "门槛" },
  ];
  const picked = selectStandardSections(["references/review-standards.md:7"], sections);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].label, "7", "按小节号精确匹配，不要命中 5.7");
  // 标题匹配是兜底（引用写的是标题而不是号）
  const byTitle = selectStandardSections(["references/grammar-review.md:通用语法审校门槛"], sections);
  assert.equal(byTitle[0].label, "4");
  // 取不到就返回空，不猜
  assert.deepEqual(selectStandardSections(["references/review-standards.md:99"], sections), []);
  assert.deepEqual(selectStandardSections(["没有冒号的引用"], sections), []);
}

/** 引用解析：文件 + 小节号（支持 `3、3.1` 这种中文顿号连写）。 */
function testRefParsing() {
  assert.deepEqual(parseStandardRef("references/review-standards.md:3、3.1"), {
    file: "references/review-standards.md",
    labels: ["3", "3.1"],
  });
  assert.deepEqual(parseStandardRef("references/grammar-review.md:语法范围"), {
    file: "references/grammar-review.md",
    labels: ["语法范围"],
  });
  assert.equal(parseStandardRef("没有冒号"), null);
  assert.equal(parseStandardRef("references/a.md:"), null);
  assert.deepEqual(standardFilesOf(["references/a.md:1", "references/a.md:2", "references/b.md:1"]), [
    "references/a.md",
    "references/b.md",
  ]);
}

/** 材料缺文件时如实返回空，不抛错也不假装取到。 */
function testMissingMaterialIsHonest() {
  const sections = parseStandardSections("# 只有一级标题\n\n没有小节", "references/x.md");
  assert.deepEqual(sections, []);
}

const tests = [
  ["基线规则完整（24 条、元数据与版本齐全）", testBaselineRulesAreComplete],
  ["38 个源行 + 2 个全书门控被覆盖（标准契约）", testSourceLinesAreCovered],
  ["判据材料随包且引用可取", testStandardsArePresentAndResolvable],
  ["判据取用是精确的", testSelectionIsExact],
  ["引用解析", testRefParsing],
  ["材料缺失时如实返回空", testMissingMaterialIsHonest],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`审校标准基线测试通过:${tests.length} 项`);
