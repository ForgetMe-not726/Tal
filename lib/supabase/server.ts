import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 服务端专用 Supabase 客户端(单例)。
 * 使用 service_role key,绕过 RLS:RLS 策略待 Phase 3 接入 Supabase Auth 后补齐。
 * 本模块只能在 Next.js 服务端(Server Components / Route Handlers / Server Actions)使用,
 * 绝不能被 "use client" 组件引用。
 */
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "缺少 Supabase 环境变量:请复制 .env.example 为 .env.local,填入 NEXT_PUBLIC_SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
