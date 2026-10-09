import type {
  BookType,
  Grade,
  RuleBindingRow,
  RuleRow,
  RuleScope,
  RuleVersionRow,
} from "@/lib/db/types";

export type RuleResolutionContext = {
  projectId?: string;
  grade?: Grade;
  bookType?: BookType;
  moduleKey?: string;
  lessonId?: string;
};

export type EffectiveRule = {
  rule: RuleRow;
  version: RuleVersionRow;
  binding: RuleBindingRow;
  /** global=0, project=1 ... lesson=5;用于审计解析来源。 */
  specificity: number;
};

export type RuleSnapshotEntry = {
  rule_id: string;
  rule_key: string;
  rule_type: RuleRow["rule_type"];
  is_hard: boolean;
  version_id: string;
  version_number: number;
  scope: RuleScope;
  binding_id: string;
  instruction: string;
  constraints: Record<string, unknown>;
};

export type RuleSnapshot = {
  schema_version: 1;
  context: RuleResolutionContext;
  rules: RuleSnapshotEntry[];
  resolved_at: string;
};

export type EffectiveRuleSet = {
  hardRules: EffectiveRule[];
  scopedRules: EffectiveRule[];
  allRules: EffectiveRule[];
  snapshot: RuleSnapshot;
};

export class RuleResolverError extends Error {}

/**
 * 按 `rule_type` 取子集：生成只看生成规则、审校只看审校规则。
 *
 * 为什么必须分流：审校标准（公司审校 Skill 迁移来的那批）进生成 Prompt 只会挤占上下文，
 * 其中的 Hard 项还会在保存时挡住老师——它检查的是"成品该长什么样"，
 * 而迁移阶段的输入是旧版教材，天然满足不了。
 *
 * `snapshot` 跟着过滤：版本记录里存的必须是**本次实际用到**的规则快照，
 * 否则历史结果会解释成"当时用了没用的规则"。
 */
export function filterRuleSetByType(
  ruleSet: EffectiveRuleSet,
  ruleType: RuleRow["rule_type"],
): EffectiveRuleSet {
  const keep = (item: EffectiveRule) => item.rule.rule_type === ruleType;
  return {
    hardRules: ruleSet.hardRules.filter(keep),
    scopedRules: ruleSet.scopedRules.filter(keep),
    allRules: ruleSet.allRules.filter(keep),
    snapshot: {
      ...ruleSet.snapshot,
      rules: ruleSet.snapshot.rules.filter((entry) => entry.rule_type === ruleType),
    },
  };
}

const SCOPE_SPECIFICITY: Record<RuleScope, number> = {
  global: 0,
  project: 1,
  grade: 2,
  book: 3,
  module: 4,
  lesson: 5,
};

function matchesContext(
  binding: RuleBindingRow,
  context: RuleResolutionContext,
): boolean {
  switch (binding.scope) {
    case "global":
      return true;
    case "project":
      return Boolean(context.projectId && binding.project_id === context.projectId);
    case "grade":
      return Boolean(context.grade && binding.grade === context.grade);
    case "book":
      return Boolean(context.bookType && binding.book_type === context.bookType);
    case "module":
      return Boolean(context.moduleKey && binding.module_key === context.moduleKey);
    case "lesson":
      return Boolean(context.lessonId && binding.lesson_id === context.lessonId);
  }
}

function cloneConstraints(raw: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(raw ?? {})) as Record<string, unknown>;
}

function toSnapshotEntry(effective: EffectiveRule): RuleSnapshotEntry {
  return {
    rule_id: effective.rule.id,
    rule_key: effective.rule.rule_key,
    rule_type: effective.rule.rule_type,
    is_hard: effective.rule.is_hard,
    version_id: effective.version.id,
    version_number: effective.version.version_number,
    scope: effective.binding.scope,
    binding_id: effective.binding.id,
    instruction: effective.version.instruction,
    constraints: cloneConstraints(effective.version.constraints),
  };
}

function ensureSinglePublished(
  rule: RuleRow,
  versions: RuleVersionRow[],
): RuleVersionRow {
  const published = versions.filter(
    (version) => version.rule_id === rule.id && version.status === "published",
  );
  if (published.length === 0) {
    throw new RuleResolverError(`规则 ${rule.rule_key} 没有生效中的 Published 版本`);
  }
  if (published.length > 1) {
    throw new RuleResolverError(`规则 ${rule.rule_key} 存在多个 Published 版本,请先修复规则库`);
  }
  return published[0];
}

/**
 * 纯解析函数:不访问数据库,便于单测和未来在生成任务中复用。
 * 普通规则取最具体绑定;Hard Rule 取最宽匹配绑定,以保证下级不能替换红线。
 */
export function buildEffectiveRuleSet(input: {
  rules: RuleRow[];
  publishedVersions: RuleVersionRow[];
  bindings: RuleBindingRow[];
  context?: RuleResolutionContext;
  resolvedAt?: string;
}): EffectiveRuleSet {
  const context = input.context ?? {};
  const rulesById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const candidatesByKey = new Map<
    string,
    Array<{ rule: RuleRow; binding: RuleBindingRow; specificity: number }>
  >();

  for (const binding of input.bindings) {
    if (!matchesContext(binding, context)) continue;
    const rule = rulesById.get(binding.rule_id);
    if (!rule) {
      throw new RuleResolverError(`规则绑定 ${binding.id} 指向不存在的规则`);
    }
    const candidates = candidatesByKey.get(rule.rule_key) ?? [];
    candidates.push({
      rule,
      binding,
      specificity: SCOPE_SPECIFICITY[binding.scope],
    });
    candidatesByKey.set(rule.rule_key, candidates);
  }

  const selected: EffectiveRule[] = [];
  for (const candidates of candidatesByKey.values()) {
    const rule = candidates[0].rule;
    const sorted = [...candidates].sort((a, b) => a.specificity - b.specificity);
    const selectedSpecificity = rule.is_hard
      ? sorted[0].specificity
      : sorted[sorted.length - 1].specificity;
    const sameScope = sorted.filter((item) => item.specificity === selectedSpecificity);
    if (sameScope.length > 1) {
      throw new RuleResolverError(
        `规则 ${rule.rule_key} 在 ${sameScope[0].binding.scope} 作用域存在多个匹配绑定`,
      );
    }
    const chosen = sameScope[0];
    selected.push({
      rule: chosen.rule,
      version: ensureSinglePublished(chosen.rule, input.publishedVersions),
      binding: chosen.binding,
      specificity: chosen.specificity,
    });
  }

  const sortRules = (a: EffectiveRule, b: EffectiveRule) =>
    a.rule.rule_key.localeCompare(b.rule.rule_key);
  const hardRules = selected.filter((item) => item.rule.is_hard).sort(sortRules);
  const scopedRules = selected.filter((item) => !item.rule.is_hard).sort(sortRules);
  const allRules = [...hardRules, ...scopedRules];
  const snapshotRules = [...selected].sort(sortRules).map(toSnapshotEntry);

  return {
    hardRules,
    scopedRules,
    allRules,
    snapshot: {
      schema_version: 1,
      context,
      rules: snapshotRules,
      resolved_at: input.resolvedAt ?? new Date().toISOString(),
    },
  };
}
