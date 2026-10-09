import { getAppStore } from "@/lib/db/store";
import type { RuleBindingRow, RuleRow, RuleVersionRow } from "@/lib/db/types";
import {
  buildEffectiveRuleSet,
  RuleResolverError,
  type EffectiveRuleSet,
  type RuleResolutionContext,
} from "@/lib/rules/resolve-core";

export * from "@/lib/rules/resolve-core";

/** 从当前数据适配器读取规则库并构建上下文对应的 Effective Rule Set。 */
export async function resolveEffectiveRules(
  context: RuleResolutionContext = {},
): Promise<EffectiveRuleSet> {
  const store = getAppStore();
  const [rules, publishedVersions, bindings] = await Promise.all([
    store.listRules(),
    store.listRuleVersions({ status: "published" }),
    store.listRuleBindings(),
  ]);

  try {
    return buildEffectiveRuleSet({
      rules: rules as RuleRow[],
      publishedVersions: publishedVersions as RuleVersionRow[],
      bindings: bindings as RuleBindingRow[],
      context,
    });
  } catch (error) {
    if (error instanceof RuleResolverError) throw error;
    throw new RuleResolverError(`解析生效规则失败:${(error as Error).message}`);
  }
}
