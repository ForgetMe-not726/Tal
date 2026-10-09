import { NextResponse } from "next/server";
import {
  resolveEffectiveRules,
  type RuleResolutionContext,
} from "@/lib/rules/resolver";
import type { BookType, Grade } from "@/lib/db/types";

/**
 * 按上下文返回 Effective Rule Set,供生成/审校节点和调试工具复用。
 * GET /api/rules/effective?projectId=...&grade=L3&bookType=student&moduleKey=...&lessonId=...
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const value = (key: string) => url.searchParams.get(key)?.trim() || undefined;
  const grade = value("grade");
  const bookType = value("bookType");
  if (grade && !["L1", "L2", "L3", "L4", "L5", "L6"].includes(grade)) {
    return NextResponse.json({ error: "grade 必须是 L1-L6" }, { status: 400 });
  }
  if (bookType && !["student", "workbook", "knowledge", "vocab"].includes(bookType)) {
    return NextResponse.json(
      { error: "bookType 必须是 student、workbook、knowledge 或 vocab" },
      { status: 400 },
    );
  }
  const context: RuleResolutionContext = {
    projectId: value("projectId"),
    grade: grade as Grade | undefined,
    bookType: bookType as BookType | undefined,
    moduleKey: value("moduleKey"),
    lessonId: value("lessonId"),
  };

  try {
    return NextResponse.json(await resolveEffectiveRules(context));
  } catch (error) {
    console.error("[api/rules/effective] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
