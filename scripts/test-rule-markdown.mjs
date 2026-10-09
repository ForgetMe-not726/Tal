import assert from "node:assert/strict";
import { parseRuleMarkdown } from "../lib/rules/markdown-import.ts";

const source = `# 规则文件

## R-KL-001 目标结构

- **指令**：目标章节必须完整。
- **类型**：普通规则。

\`\`\`json
{"required_sections":["lets_say","lets_read"]}
\`\`\`

## R-KL-002 来源确认

- **类型**：Hard Rule
- **指令**：只有确认来源可以生产。
`;

const rules = parseRuleMarkdown(source, "规则.md");
assert.equal(rules.length, 2);
assert.equal(rules[0].ruleKey, "R-KL-001");
assert.deepEqual(rules[0].constraints.required_sections, ["lets_say", "lets_read"]);
assert.equal(rules[0].ruleType, "generation");
assert.equal(rules[1].isHard, true);
assert.equal(rules[1].instruction.includes("Hard Rule"), true);

// 正文提到 Hard Rule 但类型是普通规则时，不能误判为红线。
const bodyMention = parseRuleMarkdown(
  "## R-KL-900 预算\n\n- **类型**：普通规则（生成）\n\n不得丢弃 Hard Rule 所需来源。\n\n```json\n{}\n```\n",
  "预算.md",
);
assert.equal(bodyMention[0].isHard, false);

const reviewRule = parseRuleMarkdown(
  "## R-KL-901 审校\n\n- **类型**：审校规则\n\n检查语言自然度。\n\n```json\n{}\n```\n",
  "审校.md",
);
assert.equal(reviewRule[0].ruleType, "review");

// 审校标准（公司 Skill）迁来的规则：id 形态是 `LANG-001`，元数据写在正文行里。
// 这些字段进 `payload` 而不是 `constraints`——后者是给确定性检查器的，
// 塞进去会让 unknownConstraintKeys() 对每条规则报未知键。
const skillRule = parseRuleMarkdown(
  [
    "## LANG-001 当代标准英式英语",
    "",
    "- **类型**：审校规则",
    "- **硬度**：Hard Rule",
    "- **阶段**：语言检查",
    "- **执行方式**：model_assisted",
    "- **元素**：正文、标题",
    "- **源行**：SB03、SB04",
    "- **判据**：references/review-standards.md:3、3.1",
    "- **来源**：pet-material-review v1.0.0#LANG-001",
    "",
    "- **指令**：逐词逐句核对是否为当代标准英式英语。",
    "",
    "```json",
    "{}",
    "```",
    "",
  ].join("\n"),
  "LANG-001.md",
);
assert.equal(skillRule.length, 1);
assert.equal(skillRule[0].ruleKey, "LANG-001", "Skill 的 id 形态要能识别");
assert.equal(skillRule[0].displayName, "当代标准英式英语");
assert.equal(skillRule[0].ruleType, "review", "显式声明了类型就按声明的走");
assert.equal(skillRule[0].isHard, true);
assert.deepEqual(skillRule[0].payload, {
  phase: "语言检查",
  executionMode: "model_assisted",
  elementKinds: ["正文", "标题"],
  reviewListRefs: ["SB03", "SB04"],
  standardRefs: ["references/review-standards.md:3、3.1"],
  sourceSkillRef: "pet-material-review v1.0.0#LANG-001",
});
assert.deepEqual(skillRule[0].constraints, {}, "元数据不能混进机器约束");

// 判据列表里的顿号：`a.md:3、3.1` 是**一条**引用的两个小节，不是两条引用。
// 拆错了取用时谁都对不上（standards.ts 的 parseStandardRef 认的是整串）。
const twoRefs = parseRuleMarkdown(
  "## EXAM-001 任务契约\n\n- **类型**：审校规则\n- **判据**：references/a.md:1、references/b.md:2\n\n内容。\n\n```json\n{}\n```\n",
  "d.md",
);
assert.deepEqual(
  twoRefs[0].payload.standardRefs,
  ["references/a.md:1", "references/b.md:2"],
  "顿号后面跟着新的文件引用时才当列表分隔",
);
const oneRef = parseRuleMarkdown(
  "## EXAM-002 任务契约\n\n- **类型**：审校规则\n- **判据**：references/a.md:3、3.1\n\n内容。\n\n```json\n{}\n```\n",
  "e.md",
);
assert.deepEqual(oneRef[0].payload.standardRefs, ["references/a.md:3、3.1"], "引用内部的顿号不能拆");

// 「硬度」行独立于「类型」行（审校标准迁来的写法）；老的「类型：Hard Rule」仍认。
const byHardness = parseRuleMarkdown(
  "## LANG-002 英式英语\n\n- **类型**：审校规则\n- **硬度**：Hard Rule\n\n内容。\n\n```json\n{}\n```\n",
  "f.md",
);
assert.equal(byHardness[0].isHard, true);
assert.equal(byHardness[0].ruleType, "review");

// 没写元数据时 payload 留空，不是塞一堆空串
const bare = parseRuleMarkdown(
  "## R-KL-902 普通\n\n- **类型**：普通规则\n\n内容。\n\n```json\n{}\n```\n",
  "b.md",
);
assert.deepEqual(bare[0].payload, {});

// 没声明类型时**默认生成规则**（本项目原有行为，不因为 id 长得像 Skill 的就改判）。
// 判据是显式标记而不是 id 形态：教师手写的规则 id 没有统一前缀，
// 猜错会把规则悄悄放进错误的一侧（生成侧漏掉约束、或审校侧凭空多出结论）。
const noType = parseRuleMarkdown(
  "## LANG-999 未标类型\n\n内容。\n\n```json\n{}\n```\n",
  "c.md",
);
assert.equal(noType[0].ruleType, "generation");

assert.throws(() => parseRuleMarkdown("# 没有稳定标识"), /稳定规则标识/);
assert.throws(() => parseRuleMarkdown("## R-X-1 规则\n\n```json\n坏 JSON\n```"), /无法解析/);

console.log("✓ Markdown 多规则和 constraints 解析");
console.log("✓ Hard Rule/审校类型识别与非法文件拒绝");
console.log("✓ 审校标准规则的 id 形态与元数据进 payload");
console.log("规则 Markdown 测试通过:5 项");
