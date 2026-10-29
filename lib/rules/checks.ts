import type { EffectiveRule } from "@/lib/rules/resolver";

export type CheckDocument = {
  text: string;
  sections?: string[];
  metadata?: Record<string, unknown>;
};

export type RuleCheckIssue = {
  ruleKey: string;
  versionNumber: number;
  code:
    | "min_words"
    | "max_words"
    | "banned_words"
    | "required_sections"
    | "section_order"
    | "source_annotation"
    | "source_confirmation"
    | "invalid_constraint"
    | "english_only";
  message: string;
  expected: unknown;
  actual: unknown;
  evidence?: string;
};

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/**
 * 确定性检查器认识的约束字段。
 *
 * 不在这个集合里的字段不会被检查——它们仍会存进规则库、写进规则快照、送进生成 Prompt
 * （相当于给模型的自然语言提示），但**不会拦住任何内容**。
 * 导入时用 unknownConstraintKeys() 把这类字段报出来，避免拼错字段名后以为规则已生效。
 */
export const KNOWN_CONSTRAINT_KEYS: readonly string[] = [
  "min_words",
  "words_per_lesson_min",
  "max_words",
  "words_per_lesson_max",
  "banned_words",
  "required_sections",
  "reading_sections_required",
  "required_sections_ordered",
  "require_confirmed_source",
  "require_source_annotation",
  "require_annotation_in_text",
];

/** 列出约束里检查器不认识的字段，供导入时提示。 */
export function unknownConstraintKeys(constraints: Record<string, unknown>): string[] {
  return Object.keys(constraints)
    .filter((key) => !KNOWN_CONSTRAINT_KEYS.includes(key))
    .sort();
}

function countWords(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

function markdownSections(text: string): string[] {
  return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
}

function numberConstraint(
  constraints: Record<string, unknown>,
  keys: string[],
  rule: EffectiveRule,
  issues: RuleCheckIssue[],
): number | undefined {
  const key = keys.find((candidate) => candidate in constraints);
  if (!key) return undefined;
  const value = constraints[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push({
      ruleKey: rule.rule.rule_key,
      versionNumber: rule.version.version_number,
      code: "invalid_constraint",
      message: `约束 ${key} 必须是非负数字`,
      expected: "非负数字",
      actual: value,
    });
    return undefined;
  }
  return value;
}

function listConstraint(
  constraints: Record<string, unknown>,
  keys: string[],
  rule: EffectiveRule,
  issues: RuleCheckIssue[],
): string[] | undefined {
  const key = keys.find((candidate) => candidate in constraints);
  if (!key) return undefined;
  const value = constraints[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({
      ruleKey: rule.rule.rule_key,
      versionNumber: rule.version.version_number,
      code: "invalid_constraint",
      message: `约束 ${key} 必须是字符串数组`,
      expected: "字符串数组",
      actual: value,
    });
    return undefined;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function checkRule(rule: EffectiveRule, document: CheckDocument): RuleCheckIssue[] {
  const constraints = rule.version.constraints ?? {};
  const issues: RuleCheckIssue[] = [];
  const words = countWords(document.text);
  const minWords = numberConstraint(
    constraints,
    ["min_words", "words_per_lesson_min"],
    rule,
    issues,
  );
  const maxWords = numberConstraint(
    constraints,
    ["max_words", "words_per_lesson_max"],
    rule,
    issues,
  );

  if (minWords !== undefined && words < minWords) {
    issues.push({
      ruleKey: rule.rule.rule_key,
      versionNumber: rule.version.version_number,
      code: "min_words",
      message: `正文词数少于规则要求的 ${minWords} 词`,
      expected: { min: minWords },
      actual: words,
    });
  }
  if (maxWords !== undefined && words > maxWords) {
    issues.push({
      ruleKey: rule.rule.rule_key,
      versionNumber: rule.version.version_number,
      code: "max_words",
      message: `正文词数超过规则要求的 ${maxWords} 词`,
      expected: { max: maxWords },
      actual: words,
    });
  }

  const bannedWords = listConstraint(constraints, ["banned_words"], rule, issues);
  if (bannedWords) {
    const lowerText = document.text.toLocaleLowerCase();
    const found = bannedWords.filter((word) => lowerText.includes(word.toLocaleLowerCase()));
    if (found.length > 0) {
      issues.push({
        ruleKey: rule.rule.rule_key,
        versionNumber: rule.version.version_number,
        code: "banned_words",
        message: `正文包含禁用表达:${found.join(", ")}`,
        expected: [],
        actual: found,
        evidence: found.join(", "),
      });
    }
  }

  const requiredSections = listConstraint(
    constraints,
    ["required_sections", "reading_sections_required"],
    rule,
    issues,
  );
  if (requiredSections) {
    const sections = (document.sections ?? markdownSections(document.text)).map((section) =>
      section.trim().toLocaleLowerCase(),
    );
    const missing = requiredSections.filter(
      (section) => !sections.includes(section.toLocaleLowerCase()),
    );
    if (missing.length > 0) {
      issues.push({
        ruleKey: rule.rule.rule_key,
        versionNumber: rule.version.version_number,
        code: "required_sections",
        message: `缺少必需章节:${missing.join(", ")}`,
        expected: requiredSections,
        actual: sections,
        evidence: missing.join(", "),
      });
    }
    if (constraints.required_sections_ordered === true) {
      const positions = requiredSections.map((section) =>
        sections.indexOf(section.toLocaleLowerCase()),
      );
      const ordered = positions.every((position, index) =>
        position >= 0 && (index === 0 || position > positions[index - 1]),
      );
      if (!ordered && missing.length === 0) {
        issues.push({
          ruleKey: rule.rule.rule_key,
          versionNumber: rule.version.version_number,
          code: "section_order",
          message: `必需章节顺序不符合规则:${requiredSections.join(" → ")}`,
          expected: requiredSections,
          actual: sections,
        });
      }
    }
  }

  if (constraints.require_confirmed_source === true && document.metadata?.sourceConfirmed !== true) {
    issues.push({
      ruleKey: rule.rule.rule_key,
      versionNumber: rule.version.version_number,
      code: "source_confirmation",
      message: "来源尚未被人工确认,不能作为 Production Source 生成",
      expected: true,
      actual: document.metadata?.sourceConfirmed,
    });
  }

  if (constraints.require_source_annotation === true) {
    const annotations = document.metadata?.sourceAnnotations;
    const refs = Array.isArray(annotations)
      ? annotations.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    // 来源标注保存在版本 metadata（source_refs / retrieval_trace / rule_snapshot）中，
    // 不要求把内部来源引用写进面向学生的正文。只有显式声明才额外要求出现在正文里。
    const recordedAtVersionLevel =
      annotations === true ||
      document.metadata?.sourceAnnotationPresent === true ||
      refs.length > 0;
    const requiredInText = constraints.require_annotation_in_text === true;
    const shownInText = refs.length > 0 && refs.every((ref) => document.text.includes(ref));
    if (!recordedAtVersionLevel || (requiredInText && !shownInText)) {
      issues.push({
        ruleKey: rule.rule.rule_key,
        versionNumber: rule.version.version_number,
        code: "source_annotation",
        message: requiredInText ? "正文缺少必需的来源标注" : "没有记录来源标注",
        expected: requiredInText ? refs : "版本 metadata 中的 source_refs",
        actual: annotations,
        evidence: refs.filter((ref) => !document.text.includes(ref)).join(", "),
      });
    }
  }

  return issues;
}

/**
 * 执行当前规则集里可以确定性判断的约束。
 * 无法由结构化输入确定的自然度、难度等判断留给后续 LLM Review。
 */
export function runDeterministicChecks(
  rules: EffectiveRule[] | { allRules: EffectiveRule[] },
  document: CheckDocument,
): RuleCheckIssue[] {
  const allRules = Array.isArray(rules) ? rules : rules.allRules;
  return allRules
    .flatMap((rule) => checkRule(rule, document))
    .sort(
      (a, b) =>
        a.ruleKey.localeCompare(b.ruleKey) ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message),
    );
}
