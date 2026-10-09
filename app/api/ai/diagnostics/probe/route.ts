import { NextResponse } from "next/server";
import { probeConfiguredModels } from "@/lib/ai/gateway";

/**
 * 发送每个已配置模型最多 1 token 的连接测试。
 * 响应只包含任务、模型 ID 和状态，不包含 Key、响应正文或模型生成内容。
 */
export async function POST() {
  try {
    return NextResponse.json({ results: await probeConfiguredModels() }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/ai/diagnostics/probe] POST failed:", error);
    return NextResponse.json({ error: "AI 模型连接测试失败" }, { status: 500 });
  }
}
