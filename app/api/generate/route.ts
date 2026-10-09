import { NextResponse } from "next/server";
import {
  generateModule,
  GenerationServiceError,
  normalizeGenerationInput,
} from "@/lib/generation/service";

/** MVP 真实生成入口:生成、确定性检查并保存一个新 Module Version。 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await generateModule(normalizeGenerationInput(body), request.signal);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof GenerationServiceError ? 400 : 500;
    if (status === 500) console.error("[api/generate] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
