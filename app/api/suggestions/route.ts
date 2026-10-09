import { NextResponse } from "next/server";
import {
  generateSuggestions,
  normalizeSuggestionInput,
  SuggestionServiceError,
} from "@/lib/suggestions/service";

/** 生成内容修改/替换建议,不自动修改正文。 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await generateSuggestions(normalizeSuggestionInput(body));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SuggestionServiceError ? 400 : 500;
    if (status === 500) console.error("[api/suggestions] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
