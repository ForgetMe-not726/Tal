import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import type { Grade } from "@/lib/db/types";

export const runtime = "nodejs";

const GRADES: readonly string[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

/**
 * 本地项目：列表与新建。
 *
 * 老师只面对自己的项目名、年级和学期（PRODUCT.md §3），看不到 JSON 或 ID。
 * 资料识别必须先有项目（产物落在 `projects/<id>/sources/`），制作页也要落到同一个项目，
 * 所以两页共用这一个接口——此前制作页把项目名写死在常量里，两边对不上就选不到刚识别完的来源。
 */
export async function GET() {
  try {
    const projects = await getAppStore().listProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("[api/projects] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const grade = typeof body.grade === "string" ? body.grade : "";
    const term = typeof body.term === "string" ? body.term.trim() : "";
    if (!name) return NextResponse.json({ error: "项目名不能为空" }, { status: 400 });
    if (!GRADES.includes(grade)) {
      return NextResponse.json({ error: "年级必须是 L1–L6" }, { status: 400 });
    }
    if (!term) return NextResponse.json({ error: "学期不能为空" }, { status: 400 });
    // 同名同年级同学期视为同一个项目（自然键），不重复建
    const project = await getAppStore().insertProject({
      name,
      grade: grade as Grade,
      term,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("[api/projects] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
