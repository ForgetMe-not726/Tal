import { getAppStore } from "@/lib/db/store";
import type { RuleRow, RuleVersionRow } from "@/lib/db/types";
import { KNOWN_CONSTRAINT_KEYS, unknownConstraintKeys } from "@/lib/rules/checks";
import type { ImportedRuleDefinition } from "@/lib/rules/markdown-import";

/**
 * 规则服务层:规则库 CRUD 的唯一业务入口(仅服务端调用)。
 * 版本规则(profile.md 十二):
 * - 编辑 = 创建/修改 Draft 版本;发布 = Draft → Published,旧 Published 自动 → Deprecated;
 * - Published / Deprecated 永久保留、不可再改;生成任务按需对版本做快照。
 */

export class RuleServiceError extends Error {}

export type RuleWithVersions = RuleRow & { versions: RuleVersionRow[] };

export async function listRulesWithVersions(): Promise<RuleWithVersions[]> {
  const store = getAppStore();
  const [rules, versions] = await Promise.all([store.listRules(), store.listRuleVersions()]);
  const byRule = new Map<string, RuleVersionRow[]>();
  for (const version of versions) {
    const list = byRule.get(version.rule_id) ?? [];
    list.push(version);
    byRule.set(version.rule_id, list);
  }
  return rules.map((rule) => ({
    ...rule,
    versions: (byRule.get(rule.id) ?? []).sort((a, b) => b.version_number - a.version_number),
  }));
}

export type RuleImportResult = {
  rule: RuleRow;
  version: RuleVersionRow;
  created: boolean;
  /**
   * 导入提示：约束里检查器不认识的字段。
   * 这类字段不会拦住内容，只作为自然语言提示送进生成 Prompt。
   */
  warnings: string[];
};

function constraintWarnings(constraints: Record<string, unknown>): string[] {
  const unknown = unknownConstraintKeys(constraints);
  if (unknown.length === 0) return [];
  return [
    `约束字段 ${unknown.join("、")} 没有对应的确定性检查，不会拦内容；` +
      `当前可检查的字段：${KNOWN_CONSTRAINT_KEYS.join("、")}`,
  ];
}

/** 上传的 Markdown 已代表用户确认的正式规则，直接写入 Published 并绑定全局作用域。 */
export async function importPublishedRule(
  definition: ImportedRuleDefinition,
  sourceFileName: string,
): Promise<RuleImportResult> {
  const store = getAppStore();
  let rule = (await store.listRules()).find((item) => item.rule_key === definition.ruleKey) ?? null;
  const created = !rule;
  if (!rule) {
    rule = await store.insertRule({
      rule_key: definition.ruleKey,
      display_name: definition.displayName,
      rule_type: definition.ruleType,
      is_hard: definition.isHard,
      // 规则库按来源文件分组展示，description 保留文件归属。
      description: sourceFileName,
      payload: definition.payload,
    });
  } else if (
    rule.display_name !== definition.displayName ||
    rule.rule_type !== definition.ruleType ||
    rule.is_hard !== definition.isHard ||
    rule.description !== sourceFileName ||
    // 规则元数据变了（例如审校标准升版）也要同步
    JSON.stringify(rule.payload ?? {}) !== JSON.stringify(definition.payload)
  ) {
    // 重新上传同一规则文件时，同步显示名、类型、红线和文件归属。
    rule = await store.updateRule(rule.id, {
      display_name: definition.displayName,
      rule_type: definition.ruleType,
      is_hard: definition.isHard,
      description: sourceFileName,
      payload: definition.payload,
    });
  }

  const existingVersions = await store.listRuleVersions({ ruleId: rule.id });
  for (const oldVersion of existingVersions.filter((version) => version.status !== "deprecated")) {
    await store.updateRuleVersion(rule.id, oldVersion.id, { status: "deprecated" });
  }
  const nextVersion = (existingVersions[0]?.version_number ?? 0) + 1;
  const version = await store.insertRuleVersion({
    rule_id: rule.id,
    version_number: nextVersion,
    instruction: definition.instruction,
    constraints: definition.constraints,
    status: "published",
    created_by: "rule-file-import",
    change_note: `从 ${sourceFileName} 导入 · ${definition.sourceSection}`,
    published_at: new Date().toISOString(),
  });

  const bindings = await store.listRuleBindings(rule.id);
  if (!bindings.some((binding) => binding.scope === "global")) {
    await store.insertRuleBinding({
      rule_id: rule.id,
      scope: "global",
      project_id: null,
      grade: null,
      book_type: null,
      module_key: null,
      lesson_id: null,
    });
  }
  return { rule, version, created, warnings: constraintWarnings(definition.constraints) };
}

export async function deleteRuleDefinition(ruleId: string): Promise<boolean> {
  const deleted = await getAppStore().deleteRule(ruleId);
  if (!deleted) throw new RuleServiceError("规则不存在或已删除");
  return true;
}

export async function importPublishedRules(
  definitions: ImportedRuleDefinition[],
  sourceFileName: string,
): Promise<RuleImportResult[]> {
  if (definitions.length === 0) throw new RuleServiceError("规则文件没有可导入内容");
  const results: RuleImportResult[] = [];
  for (const definition of definitions) {
    results.push(await importPublishedRule(definition, sourceFileName));
  }
  return results;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importPublishedRulesSafe(
  definitions: ImportedRuleDefinition[],
  sourceFileName: string,
): Promise<RuleImportResult[]> {
  try {
    return await importPublishedRules(definitions, sourceFileName);
  } catch (error) {
    throw new RuleServiceError(`导入规则失败:${message(error)}`);
  }
}

/** 约束字段校验:必须是合法 JSON 对象;空字符串视为无约束 */
export function parseConstraints(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") {
    if (Array.isArray(raw)) throw new RuleServiceError("机器可读约束必须是 JSON 对象,不能是数组");
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") throw new RuleServiceError("机器可读约束格式不正确");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RuleServiceError('机器可读约束必须是合法的 JSON 对象,例如 {"min_words": 120}');
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RuleServiceError("机器可读约束必须是 JSON 对象(以 { 开头)");
  }
  return parsed as Record<string, unknown>;
}

export async function createDraftVersion(
  ruleId: string,
  input: {
    instruction: string;
    constraints: Record<string, unknown>;
    changeNote?: string;
    createdBy?: string;
  },
): Promise<RuleVersionRow> {
  const store = getAppStore();
  const existingDraft = (await store.listRuleVersions({ ruleId, status: "draft" }))[0];
  if (existingDraft) {
    throw new RuleServiceError("该规则已有草稿版本,请继续编辑该草稿,或先发布/另建草稿");
  }
  const latest = await store.getLatestRuleVersion(ruleId);
  try {
    return await store.insertRuleVersion({
      rule_id: ruleId,
      version_number: (latest?.version_number ?? 0) + 1,
      instruction: input.instruction,
      constraints: input.constraints,
      status: "draft",
      created_by: input.createdBy ?? "system",
      change_note: input.changeNote ?? "",
      published_at: null,
    });
  } catch (error) {
    throw new RuleServiceError(`创建草稿失败:${message(error)}`);
  }
}

export async function updateDraftVersion(
  ruleId: string,
  versionId: string,
  input: {
    instruction: string;
    constraints: Record<string, unknown>;
    changeNote?: string;
  },
): Promise<RuleVersionRow> {
  const store = getAppStore();
  const version = await store.getRuleVersion(ruleId, versionId);
  if (!version) throw new RuleServiceError("版本不存在");
  if (version.status !== "draft") {
    throw new RuleServiceError("只有草稿可以修改;已发布版本永久保留,请基于它新建草稿");
  }
  try {
    return await store.updateRuleVersion(ruleId, versionId, {
      instruction: input.instruction,
      constraints: input.constraints,
      change_note: input.changeNote ?? "",
    });
  } catch (error) {
    throw new RuleServiceError(`保存草稿失败:${message(error)}`);
  }
}

export async function publishVersion(
  ruleId: string,
  versionId: string,
): Promise<RuleVersionRow> {
  const store = getAppStore();
  const version = await store.getRuleVersion(ruleId, versionId);
  if (!version) throw new RuleServiceError("版本不存在");
  if (version.status !== "draft") throw new RuleServiceError("只能发布草稿版本");

  // 先下线旧 Published 再发布新版本;若第二步失败可重试,旧版仍保留可追溯。
  try {
    const published = await store.listRuleVersions({ ruleId, status: "published" });
    await Promise.all(
      published.map((old) => store.updateRuleVersion(ruleId, old.id, { status: "deprecated" })),
    );
    return await store.updateRuleVersion(ruleId, versionId, {
      status: "published",
      published_at: new Date().toISOString(),
    });
  } catch (error) {
    throw new RuleServiceError(`发布失败:${message(error)}`);
  }
}
