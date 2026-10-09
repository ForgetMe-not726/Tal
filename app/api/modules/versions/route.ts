import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import {
  GenerationServiceError,
  normalizeGenerationInput,
  saveEditedModule,
} from "@/lib/generation/service";

/** 读取某个模块的版本历史。 */
export async function GET(request: Request) {
  const moduleId = new URL(request.url).searchParams.get("moduleId")?.trim();
  if (!moduleId) return NextResponse.json({ error: "moduleId 不能为空" }, { status: 400 });
  try {
    return NextResponse.json({ versions: await getAppStore().listModuleVersions({ moduleId }) });
  } catch (error) {
    console.error("[api/modules/versions] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** 将人工修改保存为新的 teacher_edited Module Version。 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    const result = await saveEditedModule(
      normalizeGenerationInput(body),
      markdown,
      typeof body.basedOnVersionId === "string" ? body.basedOnVersionId : undefined,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof GenerationServiceError ? 400 : 500;
    if (status === 500) console.error("[api/modules/versions] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
