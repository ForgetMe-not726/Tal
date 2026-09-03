/**
 * 规则库 CRUD 冒烟测试:需先 `npm run dev` 再执行 `node scripts/smoke-rules.mjs`。
 * 流程:读初始状态 → 建草稿 → 改草稿 → 重复建草稿应 400 → 发布(旧版自动废弃)
 *      → 非法 JSON 约束应 400 → 清理现场(删除测试版本、恢复原版本状态)。
 * 只操作 grammar_pacing 示例规则,结束后数据库回到 seed 状态。
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";
const RULE_ID = "b0000000-0000-4000-8000-000000000003"; // seed: grammar_pacing

async function j(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error ?? "?"}`);
  return data;
}

async function main() {
  const before = await j(await fetch(`${BASE}/api/rules`));
  const rule = before.rules.find((r) => r.id === RULE_ID);
  if (!rule) throw new Error("seed 规则不存在,请先执行 supabase/seed.sql");
  const v1 = rule.versions.find((v) => v.version_number === 1);
  const orig = { status: v1.status, published_at: v1.published_at };
  console.log("初始状态:", rule.versions.map((v) => `v${v.version_number}:${v.status}`).join(" "));

  const { version: draft } = await j(
    await fetch(`${BASE}/api/rules/${RULE_ID}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instruction: "# 冒烟测试草稿\n\n- 验证版本流转",
        constraints: { smoke: true },
        changeNote: "冒烟测试",
      }),
    }),
  );
  console.log(`1. 建草稿 -> v${draft.version_number} (${draft.status})`);

  const { version: patched } = await j(
    await fetch(`${BASE}/api/rules/${RULE_ID}/versions/${draft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instruction: "# 冒烟测试草稿(已修改)",
        constraints: { smoke: true, words: 10 },
        changeNote: "冒烟测试·修改",
      }),
    }),
  );
  console.log(`2. 改草稿 -> instruction="${patched.instruction.slice(0, 14)}" constraints=${JSON.stringify(patched.constraints)}`);

  const dup = await fetch(`${BASE}/api/rules/${RULE_ID}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "x", constraints: {} }),
  });
  console.log(`3. 重复建草稿被拒 -> HTTP ${dup.status}(预期 400)`);

  const { version: pub } = await j(
    await fetch(`${BASE}/api/rules/${RULE_ID}/versions/${draft.id}/publish`, { method: "POST" }),
  );
  const after = await j(await fetch(`${BASE}/api/rules`));
  const rule2 = after.rules.find((r) => r.id === RULE_ID);
  console.log(`4. 发布 -> ${rule2.versions.map((v) => `v${v.version_number}:${v.status}`).join(" ")}(预期 v2:published v1:deprecated)`);
  if (pub.status !== "published") throw new Error("发布状态不正确");

  const bad = await fetch(`${BASE}/api/rules/${RULE_ID}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction: "x", constraints: "{bad json" }),
  });
  console.log(`5. 非法 JSON 约束被拒 -> HTTP ${bad.status}(预期 400)`);

  // ---- 清理现场:恢复 seed 状态 ----
  const env = Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const del = await sb.from("rule_versions").delete().eq("id", draft.id);
  if (del.error) throw new Error(`清理失败:${del.error.message}`);
  const restore = await sb
    .from("rule_versions")
    .update({ status: orig.status, published_at: orig.published_at })
    .eq("id", v1.id);
  if (restore.error) throw new Error(`恢复失败:${restore.error.message}`);

  const final = await j(await fetch(`${BASE}/api/rules`));
  const rule3 = final.rules.find((r) => r.id === RULE_ID);
  console.log("6. 清理后:", rule3.versions.map((v) => `v${v.version_number}:${v.status}`).join(" "));
  const clean =
    rule3.versions.length === 1 && rule3.versions[0].status === orig.status;
  console.log(clean ? "ALL PASS ✓(数据库已恢复 seed 状态)" : "WARN: 请人工检查规则版本状态");
  if (!clean) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
});
