/**
 * 把公司审校标准 `pet-material-review` 转成本项目的规则与判据材料。
 *
 * 用法：node --experimental-strip-types scripts/convert-review-skill.mjs <skill-dir> [--check]
 *
 * 为什么写成脚本而不是手抄：这份标准自己带 `ruleset_version`，会升版；手抄一遍就再也对不上。
 * 转换是**机械**的，覆盖不全要**直接报错**，不能静默少导入几条。
 *
 * 转换原则（`docs/REVIEW-SKILL-INTEGRATION.md` §2）：
 * - 规则 id **原样沿用**（`LANG-001`），可按 id 回链原标准；
 * - 指令忠实整理 trigger + checks + decision + evidence_required，不加标准里没有的要求；
 * - 元数据（阶段/执行方式/元素/源行/判据）进 payload，与机器约束分开；
 * - 输出是**工作区存储格式**（rule.json + bindings.json + versions/1.json），
 *   随包基线复制过去即可用，不需要手工导入；
 * - id 用规则 id 派生的**确定性 UUID**，重跑结果逐字一致（可 diff）。
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SKILL_DIR = process.argv[2];
const CHECK_ONLY = process.argv.includes("--check");
if (!SKILL_DIR) {
  console.error("用法：convert-review-skill.mjs <skill-dir> [--check]");
  process.exit(1);
}

const OUT_RULES_DIR = "resources/rules";
const OUT_KNOWLEDGE = "resources/knowledge/review-standards";
const OUT_DOC = "docs/drafts/审校Skill迁移-初拟.md";
const KNOWLEDGE_FILES = [
  // SKILL.md 也在规则的判据引用里（分层流程与完成门槛），所以一并随包
  "SKILL.md",
  "references/review-list.md",
  "references/review-standards.md",
  "references/grammar-review.md",
  "references/delivery-and-sources.md",
  "data/b1-vocabulary-index.tsv",
];

const BOOK_TYPE_BY_MATERIAL = {
  学生用书: "student",
  练习册: "workbook",
  小超市: "vocab",
  知识清单: "knowledge",
};

function readSkillFile(relative) {
  try {
    return readFileSync(join(SKILL_DIR, relative), "utf8");
  } catch (error) {
    throw new Error(`读不到 Skill 文件 ${relative}：${error.message}`);
  }
}

const catalog = JSON.parse(readSkillFile("data/review-rules.json"));

/**
 * 硬度推断。
 *
 * 标准**没有**标 Hard/Soft——它的「硬门槛」六条是它自己的红线表述。
 * 这里按那六条映射到规则。**这是本项目的推断，不是标准声明**，已写进迁移稿待教研确认。
 */
const HARD_RULES = new Set([
  "FACT-001", // 事实准确与时效
  "LANG-001", // 当代标准英式英语，逐词逐句
  "ANSWER-001", // 标准答案题唯一无歧义
  "ANSWER-002", // 对抗式检查多解/无解
  "EXAM-001", // Cambridge 任务契约不得被降低
  "ALIGN-001", // 所学所练一致
  "LEVEL-001", // 不超纲（B1–B2）
  "LAYOUT-001", // 页面可读、格式有逻辑
  "TYPO-001", // 异常空格换行强调不得省略
  "VIS-001", // 图文相符、适龄安全
]);


/** 由种子派生确定性 UUID：基线文件要可 diff，随机 id 会让每次重跑都变。 */
function deterministicId(seed) {
  const hex = createHash("sha1").update(`pet-material-review:${seed}`).digest("hex");
  const part = (start, length) => hex.slice(start, start + length);
  return `${part(0, 8)}-${part(8, 4)}-5${part(13, 3)}-a${part(17, 3)}-${part(20, 12)}`;
}

function ruleInstruction(rule) {
  const lines = [
    `- **触发**：${rule.trigger}`,
    "- **检查**：",
    ...rule.checks.map((check) => `  - ${check}`),
    "- **判定**：",
    `  - 通过：${rule.decision.pass}`,
    `  - 需要修改：${rule.decision.needs_revision}`,
    `  - 材料未提供无法核查：${rule.decision.cannot_verify}`,
    `- **需要的证据**：${rule.evidence_required.join("；")}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 自检：覆盖不全、id 重复一律报错，不静默少导入
// ---------------------------------------------------------------------------

const ids = catalog.rules.map((rule) => rule.id);
const duplicate = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicate.length > 0) throw new Error(`规则 id 重复：${[...new Set(duplicate)].join("、")}`);

const reviewList = readSkillFile("references/review-list.md");
const declaredRefs = [...reviewList.matchAll(/^###\s+((?:SB|WB|VS|KL)\d{2})\b/gm)].map(
  (match) => match[1],
);
const coveredRefs = new Set(catalog.rules.flatMap((rule) => rule.review_list_refs ?? []));
const missingRefs = [...declaredRefs, "GLOBAL-FACTS", "GLOBAL-BRITISH"].filter(
  (ref) => !coveredRefs.has(ref),
);
if (missingRefs.length > 0) {
  throw new Error(`有源行没有被任何规则覆盖：${missingRefs.join("、")}`);
}
const noStandardRefs = catalog.rules.filter((rule) => (rule.standard_refs ?? []).length === 0);
if (noStandardRefs.length > 0) {
  throw new Error(`有规则没有判据引用：${noStandardRefs.map((rule) => rule.id).join("、")}`);
}

if (CHECK_ONLY) {
  console.log(
    `检查通过：${catalog.rules.length} 条规则、${declaredRefs.length}+2 个源行全覆盖、${KNOWLEDGE_FILES.length} 份判据材料`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 产出
// ---------------------------------------------------------------------------

function writeOut(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const STAMP = `${catalog.effective_date}T00:00:00.000Z`;
const ruleRows = [];

for (const rule of catalog.rules) {
  const ruleId = deterministicId(rule.id);
  const dir = join(OUT_RULES_DIR, rule.id);
  const bookTypes = rule.materials
    .filter((material) => material !== "all")
    .map((material) => BOOK_TYPE_BY_MATERIAL[material])
    .filter(Boolean);

  writeOut(
    join(dir, "rule.json"),
    `${JSON.stringify(
      {
        rule_key: rule.id,
        display_name: rule.title,
        rule_type: "review",
        is_hard: HARD_RULES.has(rule.id),
        description: `${catalog.ruleset_id} v${catalog.ruleset_version}`,
        payload: {
          phase: rule.phase,
          executionMode: rule.execution_mode,
          elementKinds: rule.element_kinds,
          materials: rule.materials,
          reviewListRefs: rule.review_list_refs,
          standardRefs: rule.standard_refs,
          sourceSkillRef: `${catalog.ruleset_id} v${catalog.ruleset_version}#${rule.id}`,
        },
        id: ruleId,
        created_at: STAMP,
        updated_at: STAMP,
      },
      null,
      2,
    )}\n`,
  );

  writeOut(
    join(dir, "versions", "1.json"),
    `${JSON.stringify(
      {
        rule_id: ruleId,
        version_number: 1,
        instruction: ruleInstruction(rule),
        constraints: {},
        status: "published",
        created_by: "skill-migration",
        change_note: `从 ${catalog.ruleset_id} v${catalog.ruleset_version} 迁移`,
        created_at: STAMP,
        published_at: STAMP,
        id: deterministicId(`${rule.id}:v1`),
      },
      null,
      2,
    )}\n`,
  );

  const bindings =
    bookTypes.length > 0
      ? bookTypes.map((bookType, index) => ({
          rule_id: ruleId,
          scope: "book",
          project_id: null,
          grade: null,
          book_type: bookType,
          module_key: null,
          lesson_id: null,
          id: deterministicId(`${rule.id}:binding:${bookType}:${index}`),
          created_at: STAMP,
        }))
      : [
          {
            rule_id: ruleId,
            scope: "global",
            project_id: null,
            grade: null,
            book_type: null,
            module_key: null,
            lesson_id: null,
            id: deterministicId(`${rule.id}:binding:global`),
            created_at: STAMP,
          },
        ];
  writeOut(join(dir, "bindings.json"), `${JSON.stringify(bindings, null, 2)}\n`);

  ruleRows.push(
    `| ${rule.id} | ${rule.phase} | ${rule.execution_mode} | ${HARD_RULES.has(rule.id) ? "Hard" : "普通"} | ${rule.title} |`,
  );
}

// 判据材料按原文放进 knowledge/：审校按 ref 精确取用，不整本塞进 Prompt
for (const file of KNOWLEDGE_FILES) {
  writeOut(join(OUT_KNOWLEDGE, file.split("/").pop()), readSkillFile(file));
}

writeOut(
  join(OUT_KNOWLEDGE, "README.md"),
  [
    "# 审校判据材料（来自公司审校标准）",
    "",
    `> 来源：\`${catalog.ruleset_id}\` v${catalog.ruleset_version}（生效 ${catalog.effective_date}）`,
    "> 由 `scripts/convert-review-skill.mjs` 机械复制，**不要手改**。",
    "",
    "审校时按规则的 `standard_refs` **按引用取用**（形如 `references/review-standards.md:3.1`），",
    "不把整份材料塞进模型上下文。`b1-vocabulary-index.tsv` 是 Cambridge B1 词表，",
    "原标准注明**仅作支持性证据、不是白名单**——判断超纲要结合义项与语境。",
    "",
  ].join("\n"),
);

writeOut(
  OUT_DOC,
  [
    "# 审校 Skill 迁移记录（初拟）",
    "",
    `> 来源：\`${catalog.ruleset_id}\` v${catalog.ruleset_version}（生效 ${catalog.effective_date}）`,
    "> 转换：`scripts/convert-review-skill.mjs`（机械转换，可重跑；id 为确定性派生，重跑结果逐字一致）",
    "",
    "## 1. 条目清单（按 `docs/REVIEW-SKILL-INTEGRATION.md` §2 的五类）",
    "",
    "| 类别 | 内容 | 处理 |",
    "|---|---|---|",
    `| 教材规则 | \`data/review-rules.json\` 的 ${catalog.rules.length} 条 | 写成 \`${OUT_RULES_DIR}/<规则 id>/\`（工作区存储格式，基线复制即可用），id 原样沿用 |`,
    "| 方法 | SKILL.md 的分层流程、红线门控、三个回归锚点 | 已落在 `lib/review/pipeline.ts` 的八段 |",
    `| 判据标准 | references 四份 + B1 词表 | 放进 \`${OUT_KNOWLEDGE}\`，按 \`standard_refs\` 取用 |`,
    "| 报告表达 | 三表/七表、逐项审校列定义、三态结果 | 映射到 `findings.json` + 固定模板 HTML 报告（不实现 XLSX） |",
    "| 实现辅助 | `scripts/*.py`、`assets/*.jpg` | 不移植；版式扫描记为后续确定性扫描器候选 |",
    "",
    `## 2. 规则清单（${catalog.rules.length} 条）`,
    "",
    "| id | 阶段 | 执行方式 | 硬度（本项目推断） | 标题 |",
    "|---|---|---|---|---|",
    ...ruleRows,
    "",
    "## 3. 字段映射",
    "",
    "| Skill 字段 | 本项目落点 |",
    "|---|---|",
    "| `rules[].id` | `rule_key`（原样沿用，可按 id 回链） |",
    "| `rules[].title` | `display_name` |",
    "| `trigger` / `checks` / `decision` / `evidence_required` | 规则版本的 `instruction` |",
    "| `phase` / `execution_mode` / `element_kinds` / `review_list_refs` / `standard_refs` | `RuleRow.payload`（元数据，不是机器约束） |",
    "| `materials` | 规则绑定作用域（`all` → global；点名教材 → book，如 EXAM-001 三条 book 绑定） |",
    "| `decision.{pass,needs_revision,cannot_verify}` | Finding 的三态语义（`cannot_verify` ↔ `insufficientEvidence`） |",
    "| `finding_lifecycle.{confirmed,dismissed,unresolved,candidate_only}` | 老师决定 `adopt / ignore / recheck` + `unverified` 标记 |",
    "| `ruleset_version` | `ReviewManifest.rules.rulesetVersion`（历史结果按原版本解释） |",
    "",
    "## 4. 待教研确认（已登记 question.md）",
    "",
    `1. **硬度推断**（Q-CORE-027）：标准没标 Hard/Soft，转换按它的「硬门槛」六条映射了 ${HARD_RULES.size} 条为 Hard Rule；`,
    "2. **严重度**：已按标准的「不新增严重度字段」执行（2026-10-09 确认，见 question.md A-014）；",
    "3. **逐元素通过记录**（Q-CORE-028）：标准要求登记全部叶元素并保留「通过」项（precision-v2），工作台目前只记问题；",
    "4. **human_visual 四条**（Q-CORE-029）：工作台审的是文字稿、没有成品图片与样式证据，按标准自己的 `cannot_verify` 处理。",
    "",
    "## 5. 重新生成",
    "",
    "```bash",
    "node --experimental-strip-types scripts/convert-review-skill.mjs <skill-dir>   # 生成",
    "node --experimental-strip-types scripts/convert-review-skill.mjs <skill-dir> --check   # 只自检",
    "npm run test:review-skill   # 离线校验仓库里的基线（不需要 Skill 源目录）",
    "```",
    "",
    "改动本目录内容请改转换脚本后重跑，**不要手改生成物**：id 是确定性派生的，重跑结果逐字一致，手改会被下次重跑冲掉。",
    "",
  ].join("\n"),
);

console.log(
  `已生成：${catalog.rules.length} 条规则 → ${OUT_RULES_DIR}/<id>/、${KNOWLEDGE_FILES.length} 份判据材料 → ${OUT_KNOWLEDGE}/、迁移记录 → ${OUT_DOC}`,
);
