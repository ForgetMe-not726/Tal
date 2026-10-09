import { NextResponse } from "next/server";
import { discoverAiModels } from "@/lib/ai/gateway";

/**
 * 本地 AI 连接诊断：只返回协议、脱敏地址和可用模型 ID，绝不返回 API Key 或网关响应原文。
 */
export async function GET() {
  try {
    return NextResponse.json(await discoverAiModels(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/ai/diagnostics] GET failed:", error);
    return NextResponse.json(
      {
        provider: process.env.AI_PROVIDER ?? "mock",
        configured: false,
        baseUrl: null,
        models: [],
        modelsEndpoint: "error",
        error: "AI 连接诊断失败",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}
