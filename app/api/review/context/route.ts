import { NextResponse } from "next/server";
import { getAppStore } from "@/lib/db/store";
import { ReviewError } from "@/lib/review/types";
import type { BookType } from "@/lib/db/types";

export const runtime = "nodejs";

/**
 * 审校页的上下文：这一课有哪些 Lesson、以及某一课某书种下**已有版本**的模块。
 *
 * 只列有内容的：审校的对象是已保存的模块版本，没有版本的模块审不了。
 * 一个路由覆盖两种查询（带不带 lessonNumber），少一份重复代码。
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim();
    if (!projectId) throw new ReviewError("缺少项目");
    const project = await getAppStore().getProjectById(projectId);
    if (!project) throw new ReviewError("项目不存在");

    const store = getAppStore();
    const allLessons = await store.listLessons(projectId);
    const lessons = allLessons
      .map((lesson) => ({ lessonNumber: lesson.lesson_number, title: lesson.title }))
      .sort((a, b) => a.lessonNumber - b.lessonNumber);

    const lessonParam = url.searchParams.get("lessonNumber");
    const bookType = url.searchParams.get("bookType");
    if (!lessonParam || !bookType) {
      return NextResponse.json({ lessons, modules: [] });
    }
    const lessonNumber = Number(lessonParam);
    const lesson = allLessons.find((item) => item.lesson_number === lessonNumber);
    if (!lesson) return NextResponse.json({ lessons, modules: [] });

    const books = (await store.listBooksByLesson(lesson.id)).filter(
      (book) => book.book_type === (bookType as BookType),
    );
    const modules = [];
    for (const book of books) {
      const rows = (await store.listModulesByBookIds([book.id])).sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      for (const row of rows) {
        const versions = await store.listModuleVersions({ moduleId: row.id });
        if (versions.length === 0) continue;
        const latest = versions.sort((a, b) => b.version_number - a.version_number)[0];
        modules.push({
          moduleId: row.id,
          moduleKey: row.module_key,
          label: row.display_name || row.module_key,
          versionNumber: latest.version_number,
        });
      }
    }
    return NextResponse.json({ lessons, modules });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/context] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
