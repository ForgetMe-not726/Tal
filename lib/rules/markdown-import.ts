export class RuleMarkdownImportError extends Error {}

export type ImportedRuleDefinition = {
  ruleKey: string;
  displayName: string;
  instruction: string;
  constraints: Record<string, unknown>;
  /** 规则元数据（阶段、执行方式、源行映射等）；没有就是空对象。 */
  payload: Record<string, unknown>;
  ruleType: "generation" | "review";
  isHard: boolean;
  description: string;
  sourceSection: string;
};

/**
 * 规则标题。两种 id 形态都认：
 * - 本项目草稿的 `R-XX-NNN`（如 `R-SB-001`）；
 * - 公司审校标准 `pet-material-review` 的 `PHASE-NNN`（如 `LANG-001`）——
 *   它的 id 是那套标准的主键，迁移时**原样沿用**，不做前缀改写（契约要求可按 id 回链）。
 */
const RULE_HEADING = /^#{1,4}\s+((?:R-[A-Z0-9][A-Z0-9._-]*|[A-Z][A-Z0-9]{1,15}-[0-9]{3}))\s+(.+)$/gim;
const JSON_BLOCK = /```json\s*([\s\S]*?)```/i;

function parseConstraints(section: string, ruleKey: string): Record<string, unknown> {
  const match = section.match(JSON_BLOCK);
  if (!match) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch (error) {
    throw new RuleMarkdownImportError(`${ruleKey} 的 JSON constraints 无法解析:${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RuleMarkdownImportError(`${ruleKey} 的 constraints 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function humanInstruction(section: string): string {
  return section.replace(/```json\s*[\s\S]*?```/gi, "").trim() || section.trim();
}

/**
 * 读一行声明（`- **类型**：审校规则`）。
 *
 * 只读**带标签的那一行**，避免正文里提到 Hard Rule 时被误判。
 * 模式用普通字符串拼、不用模板字符串：模板字符串里 `\*` 会退化成 `*`、`\s` 会退化成 `s`，
 * 拼出来的正则要么匹配错、要么直接抛 "Nothing to repeat"。
 */
function declaredField(section: string, label: string): string | null {
  const pattern =
    "^[^\\n]*\\*{0,2}" + escapeRegExp(label) + "\\*{0,2}\\s*[:：]\\s*([^\\n]*)$";
  const match = section.match(new RegExp(pattern, "mu"));
  return match?.[1]?.trim() ?? null;
}

/** 字段名按字面量匹配（标签是中文，但不假定以后不会出现正则元字符）。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declaredType(section: string): string | null {
  return declaredField(section, "类型");
}

function inferRuleType(ruleKey: string, section: string): "generation" | "review" {
  // 显式类型标记优先；否则只有规则标识本身含 review 才视为审校规则。
  const declared = declaredType(section);
  if (declared && /审校|review/iu.test(declared)) return "review";
  if (/review/iu.test(ruleKey)) return "review";
  return "generation";
}

/**
 * 规则的可选元数据（审校标准迁移时带过来的）。
 *
 * 这些是**规则元数据**，不是给确定性检查器的机器约束——所以进 `payload` 而不是
 * `constraints`（后者塞进去会让 `unknownConstraintKeys()` 对每条规则报未知键）。
 * 缺失时一律不写，现有规则不受影响。
 */
const PAYLOAD_FIELDS: ReadonlyArray<{ key: string; label: string; list?: boolean; refs?: boolean }> = [
  { key: "phase", label: "阶段" },
  { key: "executionMode", label: "执行方式" },
  { key: "elementKinds", label: "元素", list: true },
  { key: "reviewListRefs", label: "源行", list: true },
  { key: "standardRefs", label: "判据", list: true, refs: true },
  { key: "sourceSkillRef", label: "来源" },
];

function parsePayload(section: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of PAYLOAD_FIELDS) {
    const value = declaredField(section, field.label);
    if (!value) continue;
    payload[field.key] = field.list
      ? splitList(value, field.refs)
      : value;
  }
  return payload;
}

/**
 * 拆列表字段。
 *
 * `判据` 特殊：顿号在**引用内部**也是合法分隔符（`a.md:3、3.1` 是**一条**引用的两个小节，
 * 见 `lib/review/standards.ts` 的 `parseStandardRef`），所以顿号只在后面跟着新的文件引用时
 * 才算列表分隔——否则会把一条引用拆成两半，取用时谁都对不上。
 */
function splitList(value: string, refs?: boolean): string[] {
  const parts = value.split(refs ? /[;；,，]/u : /[,，、;；]/u);
  const items = refs ? parts.flatMap((part) => part.split(/、\s*(?=\S*\.md\s*[:：])/u)) : parts;
  return items.map((item) => item.trim()).filter(Boolean);
}

function inferHardRule(section: string): boolean {
  // 显式的「硬度」行优先；否则看「类型」行——项目原有的写法把硬度写在类型里
  // （`- **类型**：Hard Rule`），不能因为加了新写法就不认老写法。
  const hardness = declaredField(section, "硬度") ?? declaredType(section);
  return hardness ? /Hard\s*Rule|硬规则|红线|不可覆盖/iu.test(hardness) : false;
}

export function parseRuleMarkdown(markdown: string, fileName = "rules.md"): ImportedRuleDefinition[] {
  const source = markdown.replace(/^﻿/u, "").trim();
  if (!source) throw new RuleMarkdownImportError("规则文件为空");
  const headings = [...source.matchAll(RULE_HEADING)];
  if (headings.length === 0) {
    throw new RuleMarkdownImportError("未找到稳定规则标识；规则标题需要用 R-XX-NNN 或 LANG-001 这类格式");
  }
  const seen = new Set<string>();
  return headings.map((heading, index) => {
    const ruleKey = (heading[1] ?? "").trim();
    const displayName = (heading[2] ?? "").trim();
    const start = heading.index ?? 0;
    const bodyStart = start + heading[0].length;
    const end = headings[index + 1]?.index ?? source.length;
    const section = source.slice(bodyStart, end).trim();
    if (!section) throw new RuleMarkdownImportError(`${ruleKey} 没有规则内容`);
    if (seen.has(ruleKey)) throw new RuleMarkdownImportError(`规则文件中重复出现:${ruleKey}`);
    seen.add(ruleKey);
    const constraints = parseConstraints(section, ruleKey);
    return {
      ruleKey,
      displayName,
      instruction: humanInstruction(section),
      constraints,
      payload: parsePayload(section),
      ruleType: inferRuleType(ruleKey, section),
      isHard: inferHardRule(section),
      description: `从 ${fileName} 导入`,
      sourceSection: heading[0].trim(),
    };
  });
}
