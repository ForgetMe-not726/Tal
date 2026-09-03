import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { RuleRow, RuleVersionRow } from "@/lib/db/types";

/**
 * 规则服务层:规则库 CRUD 的唯一业务入口(仅服务端调用)。
 * 版本规则(profile.md 十二):
 * - 编辑 = 创建/修改 Draft 版本;发布 = Draft → Published,旧 Published 自动 → Deprecated;
 * - Published / Deprecated 永久保留、不可再改;生成任务按需对版本做快照。
 */

export class RuleServiceError extends Error {}

export type RuleWithVersions = RuleRow & { versions: RuleVersionRow[] };

export async function listRulesWithVersions(): Promise<RuleWithVersions[]> {
  const sb = getSupabaseAdmin();
  const [rulesRes, versionsRes] = await Promise.all([
    sb.from("rules").select("*").order("rule_key"),
    sb
      .from("rule_versions")
      .select("*")
      .order("version_number", { ascending: false }),
  ]);
  if (rulesRes.error) throw new RuleServiceError(`读取规则失败:${rulesRes.error.message}`);
  if (versionsRes.error)
    throw new RuleServiceError(`读取规则版本失败:${versionsRes.error.message}`);

  const byRule = new Map<string, RuleVersionRow[]>();
  for (const v of versionsRes.data as RuleVersionRow[]) {
    const list = byRule.get(v.rule_id) ?? [];
    list.push(v);
    byRule.set(v.rule_id, list);
  }
  return (rulesRes.data as RuleRow[]).map((r) => ({
    ...r,
    versions: byRule.get(r.id) ?? [],
  }));
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
  const sb = getSupabaseAdmin();
  const { data: existingDraft } = await sb
    .from("rule_versions")
    .select("id")
    .eq("rule_id", ruleId)
    .eq("status", "draft")
    .maybeSingle();
  if (existingDraft) {
    throw new RuleServiceError("该规则已有草稿版本,请继续编辑该草稿,或先发布/另建前处理它");
  }
  const { data: latest } = await sb
    .from("rule_versions")
    .select("version_number")
    .eq("rule_id", ruleId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (latest?.version_number ?? 0) + 1;

  const { data, error } = await sb
    .from("rule_versions")
    .insert({
      rule_id: ruleId,
      version_number: nextNumber,
      instruction: input.instruction,
      constraints: input.constraints,
      change_note: input.changeNote ?? "",
      created_by: input.createdBy ?? "system",
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw new RuleServiceError(`创建草稿失败:${error.message}`);
  return data as RuleVersionRow;
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
  const sb = getSupabaseAdmin();
  const { data: ver } = await sb
    .from("rule_versions")
    .select("id,status")
    .eq("id", versionId)
    .eq("rule_id", ruleId)
    .maybeSingle();
  if (!ver) throw new RuleServiceError("版本不存在");
  if (ver.status !== "draft") {
    throw new RuleServiceError("只有草稿可以修改;已发布版本永久保留,请基于它新建草稿");
  }
  const { data, error } = await sb
    .from("rule_versions")
    .update({
      instruction: input.instruction,
      constraints: input.constraints,
      change_note: input.changeNote ?? "",
    })
    .eq("id", versionId)
    .select("*")
    .single();
  if (error) throw new RuleServiceError(`保存草稿失败:${error.message}`);
  return data as RuleVersionRow;
}

export async function publishVersion(
  ruleId: string,
  versionId: string,
): Promise<RuleVersionRow> {
  const sb = getSupabaseAdmin();
  const { data: ver } = await sb
    .from("rule_versions")
    .select("id,status")
    .eq("id", versionId)
    .eq("rule_id", ruleId)
    .maybeSingle();
  if (!ver) throw new RuleServiceError("版本不存在");
  if (ver.status !== "draft") throw new RuleServiceError("只能发布草稿版本");

  // 无跨表事务:先下线旧 Published 再发布新版本;若第二步失败可重试,旧版仍保留可追溯
  const { error: depErr } = await sb
    .from("rule_versions")
    .update({ status: "deprecated" })
    .eq("rule_id", ruleId)
    .eq("status", "published");
  if (depErr) throw new RuleServiceError(`下线旧版本失败:${depErr.message}`);

  const { data, error } = await sb
    .from("rule_versions")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", versionId)
    .select("*")
    .single();
  if (error) throw new RuleServiceError(`发布失败:${error.message}`);
  return data as RuleVersionRow;
}
