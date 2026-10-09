import { NextResponse } from "next/server";

import {
  KnowledgeRepositoryError,
  listSourceImports,
  saveSourceImport,
} from "@/lib/knowledge/repository";
import type { SourceImportInput, SourceReviewStatus } from "@/lib/knowledge/types";

function normalize(body: Record<string, unknown>): SourceImportInput {
  const requiredString = (key: string, label: string) => {
    const value = body[key];
    if (typeof value !== "string" || !value.trim()) throw new KnowledgeRepositoryError(`${label}不能为空`);
    return value.trim();
  };
  const grade = requiredString("grade", "年级");
  if (!["L1", "L2", "L3", "L4", "L5", "L6"].includes(grade)) {
    throw new KnowledgeRepositoryError("年级必须是 L1-L6");
  }
  const sourceBookType = requiredString("sourceBookType", "来源书种");
  if (!["student", "workbook", "knowledge", "vocab"].includes(sourceBookType)) {
    throw new KnowledgeRepositoryError("来源书种不受支持");
  }
  const targetBookType = typeof body.targetBookType === "string" ? body.targetBookType.trim() : sourceBookType;
  if (!["student", "workbook", "knowledge", "vocab"].includes(targetBookType)) {
    throw new KnowledgeRepositoryError("目标书种不受支持");
  }
  const status = body.status === "confirmed" ? "confirmed" : "pending";
  const lessonNumber = Number(body.lessonNumber);
  if (!Number.isInteger(lessonNumber) || lessonNumber <= 0) {
    throw new KnowledgeRepositoryError("Lesson 编号必须是正整数");
  }
  return {
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    projectName: typeof body.projectName === "string" ? body.projectName : undefined,
    grade: grade as SourceImportInput["grade"],
    term: requiredString("term", "学期"),
    lessonId: typeof body.lessonId === "string" ? body.lessonId : undefined,
    lessonNumber,
    lessonTitle: requiredString("lessonTitle", "Lesson 标题"),
    sourceBookType: sourceBookType as SourceImportInput["sourceBookType"],
    targetBookType: targetBookType as SourceImportInput["targetBookType"],
    moduleKey: requiredString("moduleKey", "模块标识"),
    moduleLabel: requiredString("moduleLabel", "模块名称"),
    sourceModuleTitle: typeof body.sourceModuleTitle === "string" ? body.sourceModuleTitle : undefined,
    rawText: typeof body.rawText === "string" ? body.rawText : undefined,
    confirmedText: typeof body.confirmedText === "string" ? body.confirmedText : undefined,
    sourceDocument: typeof body.sourceDocument === "string" ? body.sourceDocument : undefined,
    page: typeof body.page === "number" && Number.isInteger(body.page) ? body.page : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    status: status as SourceReviewStatus,
    targetModuleIds: Array.isArray(body.targetModuleIds)
      ? body.targetModuleIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined,
    mappingType: typeof body.mappingType === "string" ? body.mappingType : undefined,
    mappingPriority: typeof body.mappingPriority === "number" ? body.mappingPriority : undefined,
    layer: knowledgeLayer(body.layer),
  };
}

/** 知识分层；不传按旧版教材处理，非法值直接拒绝而不是静默落到默认层。 */
function knowledgeLayer(value: unknown): SourceImportInput["layer"] {
  if (value == null || value === "") return undefined;
  if (
    value === "production_source" ||
    value === "authoritative_standards" ||
    value === "reference_materials"
  ) {
    return value;
  }
  throw new KnowledgeRepositoryError(`知识分层不受支持:${String(value)}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const sourceBookType = url.searchParams.get("sourceBookType") ?? undefined;
    const status = url.searchParams.get("status");
    if (status && status !== "pending" && status !== "confirmed") {
      return NextResponse.json({ error: "status 必须是 pending 或 confirmed" }, { status: 400 });
    }
    return NextResponse.json({
      sources: await listSourceImports({
        projectId: url.searchParams.get("projectId") ?? undefined,
        lessonId: url.searchParams.get("lessonId") ?? undefined,
        sourceBookType,
        status: status as SourceReviewStatus | undefined,
      }),
      source: "workspace",
    });
  } catch (error) {
    console.error("[api/source-content] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const result = await saveSourceImport(normalize((await request.json()) as Record<string, unknown>));
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    const status = error instanceof KnowledgeRepositoryError ? 400 : 500;
    if (status === 500) console.error("[api/source-content] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
