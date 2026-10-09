import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import { listJobRecords } from "@/lib/review/jobs";
import { assertScope, startReview } from "@/lib/review/service";
import { ReviewError } from "@/lib/review/types";
import type { BookType } from "@/lib/db/types";

export const runtime = "nodejs";

const BOOK_TYPES: readonly string[] = ["student", "workbook", "knowledge", "vocab"];

/**
 * 新建审校任务 / 列出任务。
 *
 * 审校对象永远是**已保存的模块版本**，不是界面上的草稿——报告要能说清"审的是哪一版"。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) throw new ReviewError("缺少项目");
    const lessonNumber = Number(body.lessonNumber);
    if (!Number.isInteger(lessonNumber) || lessonNumber <= 0) {
      throw new ReviewError("Lesson 编号必须是正整数");
    }
    const scope = assertScope(body.scope);
    const bookType = typeof body.bookType === "string" ? body.bookType : undefined;
    if (bookType && !BOOK_TYPES.includes(bookType)) throw new ReviewError(`书种不受支持：${bookType}`);
    if (scope === "module" && typeof body.moduleKey !== "string") {
      throw new ReviewError("模块范围需要指定模块");
    }
    const project = await getAppStore().getProjectById(projectId);
    if (!project) throw new ReviewError("项目不存在");

    const { jobId } = await startReview({
      projectId,
      lessonNumber,
      scope,
      bookType: bookType as BookType | undefined,
      moduleKey: typeof body.moduleKey === "string" ? body.moduleKey : undefined,
      versionIds: Array.isArray(body.versionIds)
        ? body.versionIds.filter((item): item is string => typeof item === "string")
        : undefined,
    });
    return NextResponse.json({ jobId }, { status: 201 });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() || undefined;
    const lessonParam = url.searchParams.get("lessonNumber");
    const lessonNumber = lessonParam ? Number(lessonParam) : undefined;
    const jobs = await listJobRecords({ projectId, lessonNumber });
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("[api/review] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
