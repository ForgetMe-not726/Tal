import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import { listModuleDefinitions, resolveModuleOutline } from "@/lib/modules/service";
import type { BookType, LessonType } from "@/lib/db/types";

const BOOK_TYPES = ["student", "workbook", "knowledge", "vocab"] as const;

/**
 * 返回 canonical 模块目录;演示目录会明确标记,不伪装成正式教研目录。
 *
 * 返回的是**解析后**的模块定义（数据库 payload 已覆盖出厂默认），并且按课型过滤。
 * 客户端因此不需要知道 payload 的合并规则；骨架缺失也会在这里就报错，
 * 而不是等到生成时静默回退。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawBookType = url.searchParams.get("bookType");
  const bookType = rawBookType as BookType | null;
  if (rawBookType && !BOOK_TYPES.includes(rawBookType as (typeof BOOK_TYPES)[number])) {
    return NextResponse.json({ error: "bookType 不受支持" }, { status: 400 });
  }
  const rawLessonType = url.searchParams.get("lessonType");
  if (rawLessonType && rawLessonType !== "regular" && rawLessonType !== "revision") {
    return NextResponse.json({ error: "lessonType 不受支持" }, { status: 400 });
  }
  const lessonType = (rawLessonType ?? undefined) as LessonType | undefined;
  try {
    const rows = await listModuleDefinitions(bookType ?? undefined, lessonType);
    // 骨架按课型解析：复习课用 revisionOutline（小节结构与常规课不同）。
    const modules = rows.map((row) => ({ id: row.id, ...resolveModuleOutline(row, lessonType ?? "regular") }));
    const formal = rows.length > 0 && rows.every((row) => row.payload.formal !== false);
    return NextResponse.json({
      modules,
      source: "workspace",
      formal,
    });
  } catch (error) {
    console.error("[api/module-definitions] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** 导入一个正式或演示模块目录项;内容仍由数据库/适配器管理,不写进组件。 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const bookType = typeof body.bookType === "string" ? body.bookType : "";
    const moduleKey = typeof body.moduleKey === "string" ? body.moduleKey.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!BOOK_TYPES.includes(bookType as (typeof BOOK_TYPES)[number])) throw new Error("bookType 不受支持");
    if (!moduleKey) throw new Error("模块标识不能为空");
    if (!displayName) throw new Error("模块名称不能为空");
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload as Record<string, unknown>
      : {};
    const row = await getAppStore().insertModuleDefinition({
      book_type: bookType as BookType,
      module_key: moduleKey,
      display_name: displayName,
      sort_order: typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
      description: typeof body.description === "string" ? body.description.trim() : "",
      payload,
    });
    return NextResponse.json({ module: row }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    const status = /不能为空|不受支持|相同模块/.test(message) ? 400 : 500;
    if (status === 500) console.error("[api/module-definitions] POST failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
