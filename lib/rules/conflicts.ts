/**
 * 规则之间在同一约束上的**冲突与覆盖关系**。
 *
 * 为什么需要：`docs/AI-ASSISTANT-RETRIEVAL.md` §2 要求规则压缩保留「优先级关系和冲突状态」。
 * 只把规则原文丢给模型，模型看不出两条规则在同一个约束上给了不同的值——
 * 它会随便挑一条照做，而老师看到的是一次说不清依据的改动。
 *
 * 这里是**如实报告**，不是改规则解析结果：作用域优先级仍由 `resolve-core.ts` 决定，
 * 本模块只把"同一约束被谁设成了什么"摊开。
 */

import type { RuleScope } from "@/lib/db/types";
import type { EffectiveRule } from "./resolve-core.ts";

/**
 * 同一个概念的不同约束键名。
 *
 * `checks.ts` 就是按这些组取「第一个命中的键」（`numberConstraint` 的 `keys.find(...)`），
 * 所以冲突检测也必须先归一，否则 `min_words` 与 `words_per_lesson_min` 会被当成两回事。
 */
const CONSTRAINT_ALIASES: ReadonlyArray<readonly string[]> = [
  ["min_words", "words_per_lesson_min"],
  ["max_words", "words_per_lesson_max"],
];

/** 把约束键归一到它所在别名组的代表键。 */
export function normalizeConstraintKey(key: string): string {
  for (const group of CONSTRAINT_ALIASES) {
    if (group.includes(key)) return group[0]!;
  }
  return key;
}

/**
 * **顺序敏感**的约束：内容或顺序不同就是真冲突，不能取并集。
 *
 * 只有 `required_sections_ordered` 是这样——它表达的是章节顺序，
 * 两条规则给出不同顺序时没有"合并"一说。
 */
const ORDER_SENSITIVE_KEYS = new Set(["required_sections_ordered"]);

/**
 * 两个值是否真的互相矛盾。
 *
 * 关键区别：**列表类约束是累加的，不是冲突的**。实测工作区里 4 条规则各自
 * `banned_words` 一个不同的禁用词表（学生用书一条、练习册两条…），它们合起来是
 * "这些词都不能出现"，取并集即可——按"值不同就冲突"报会每跑一次就喊一次狼。
 * 数字类（词数上下限）不同值才是真冲突：两条规则对同一个量给了不同要求。
 * 类型不一致（一边是数组一边是数字）也算冲突——那一定是哪里写错了。
 */
function isContradiction(key: string, values: readonly unknown[]): boolean {
  const arrays = values.filter((value) => Array.isArray(value));
  if (arrays.length === values.length) {
    if (ORDER_SENSITIVE_KEYS.has(key)) {
      return new Set(values.map((value) => JSON.stringify(value))).size > 1;
    }
    // 列表类：累加，不算冲突
    return false;
  }
  if (arrays.length > 0) return true; // 一边列表一边标量 → 写法不一致
  return new Set(values.map((value) => JSON.stringify(value ?? null))).size > 1;
}

export type ConstraintConflictEntry = {
  ruleKey: string;
  scope: RuleScope;
  isHard: boolean;
  /** 作用域具体度：global=0 … lesson=5，越大越具体。 */
  specificity: number;
  value: unknown;
};

export type ConstraintConflict = {
  /** 归一后的约束键。 */
  key: string;
  entries: ConstraintConflictEntry[];
  /** 同一个约束被设成了**不同**的值（同值只是重复，不算冲突）。 */
  conflicting: boolean;
  /**
   * 红线也设了这个约束，而更具体作用域的规则设了**不同的**值——
   * 那条规则的值不会生效（项目共识：Hard Rule 不可被低层覆盖）。
   */
  overriddenHard: boolean;
};

/**
 * 找出同一约束被多条规则设置、且值不一致的情况。
 *
 * 只报告真正会出问题的：值相同的重复设置不算冲突（否则规则库里正常的"多层都写了同一条"
 * 会刷出一屏噪声）。
 */
export function constraintConflicts(rules: readonly EffectiveRule[]): ConstraintConflict[] {
  const groups = new Map<string, ConstraintConflictEntry[]>();
  for (const item of rules) {
    const constraints = item.version.constraints ?? {};
    for (const [rawKey, value] of Object.entries(constraints)) {
      const key = normalizeConstraintKey(rawKey);
      const list = groups.get(key) ?? [];
      list.push({
        ruleKey: item.rule.rule_key,
        scope: item.binding.scope,
        isHard: item.rule.is_hard,
        specificity: item.specificity,
        value,
      });
      groups.set(key, list);
    }
  }

  const conflicts: ConstraintConflict[] = [];
  for (const [key, entries] of groups) {
    if (!isContradiction(key, entries.map((entry) => entry.value))) continue;
    const hardEntries = entries.filter((entry) => entry.isHard);
    const overriddenHard = entries.some(
      (entry) =>
        !entry.isHard &&
        hardEntries.some(
          (hard) =>
            hard.specificity < entry.specificity &&
            JSON.stringify(hard.value ?? null) !== JSON.stringify(entry.value ?? null),
        ),
    );
    conflicts.push({ key, entries, conflicting: true, overriddenHard });
  }
  return conflicts.sort((a, b) => a.key.localeCompare(b.key));
}

/** 一句话说清一条冲突，给 Prompt 与界面共用。 */
export function describeConflict(conflict: ConstraintConflict): string {
  const parts = conflict.entries.map(
    (entry) =>
      `${entry.ruleKey}（${entry.scope}${entry.isHard ? "，红线" : ""}）= ${JSON.stringify(entry.value)}`,
  );
  return `${conflict.key}：${parts.join("；")}${
    conflict.overriddenHard ? "（更具体作用域的值不会生效，红线优先）" : ""
  }`;
}
