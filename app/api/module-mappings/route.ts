import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import { listModuleDefinitions } from "@/lib/modules/service";

function required(body: Record<string, unknown>, key: string, label: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const mappings = await getAppStore().listModuleMappings({
      projectId: url.searchParams.get("projectId") ?? undefined,
      sourceModuleIds: url.searchParams.get("sourceModuleId")
        ? [url.searchParams.get("sourceModuleId") as string]
        : undefined,
      targetModuleId: url.searchParams.get("targetModuleId") ?? undefined,
    });
    return NextResponse.json({ mappings });
  } catch (error) {
    console.error("[api/module-mappings] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectId = required(body, "projectId", "项目 ID");
    const sourceModuleId = required(body, "sourceModuleId", "来源模块 ID");
    const targetModuleId = required(body, "targetModuleId", "目标模块 ID");
    const source = await getAppStore().getSourceModule(sourceModuleId);
    if (!source || source.project_id !== projectId) throw new Error("来源模块不存在或不属于当前项目");
    const definitions = await listModuleDefinitions();
    if (!definitions.some((definition) => definition.id === targetModuleId)) throw new Error("目标模块目录不存在");
    const mapping = await getAppStore().insertModuleMapping({
      project_id: projectId,
      source_module_id: sourceModuleId,
      target_module_id: targetModuleId,
      mapping_type: typeof body.mappingType === "string" && body.mappingType.trim() ? body.mappingType.trim() : "manual",
      priority: typeof body.priority === "number" && Number.isInteger(body.priority) ? Math.max(0, body.priority) : 0,
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
      payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {},
    });
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    const status = /不能为空|不存在|不属于/.test(message) ? 400 : 500;
    if (status === 500) console.error("[api/module-mappings] POST failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
