/**
 * 同一 Lesson 里**其他已确认模块**的正文。
 *
 * 生成与修改建议都要它（"相关书种上下文"），所以从 `lib/generation/service.ts` 抽出来共用。
 * 只取 `status === "confirmed"` 的模块：草稿不是事实源，不能当上下文依据。
 */

import { getAppStore } from "../db/store.ts";
import type { ModuleVersionRow } from "@/lib/db/types";

export type RelatedVersion = {
  bookType: string;
  moduleKey: string;
  moduleLabel: string;
  version: ModuleVersionRow;
  markdown: string;
};

/** 正文可能是字符串，也可能是 `{ markdown }`——两种历史形态都要认。 */
export function contentToMarkdown(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const value = content as { markdown?: unknown };
    if (typeof value.markdown === "string") return value.markdown;
  }
  return "";
}

export async function loadRelatedVersions(input: {
  lessonId: string;
  /** 排除自己（生成/修改建议都不该把自己的正文当"其他内容"）。 */
  excludeModuleId?: string;
  /** 只保留这些书种；不给就全部。 */
  bookTypes?: readonly string[];
  /** 总字符预算，超出按顺序截断并如实报告（返回 `omitted`）。 */
  maxChars?: number;
}): Promise<{ versions: RelatedVersion[]; omitted: number }> {
  const store = getAppStore();
  const books = await store.listBooksByLesson(input.lessonId);
  const wanted = input.bookTypes?.length
    ? books.filter((book) => input.bookTypes!.includes(book.book_type))
    : books;
  if (wanted.length === 0) return { versions: [], omitted: 0 };

  const modules = await store.listModulesByBookIds(wanted.map((book) => book.id));
  const eligible = modules.filter(
    (module) => module.id !== input.excludeModuleId && module.status === "confirmed",
  );
  if (eligible.length === 0) return { versions: [], omitted: 0 };

  const versions = await store.listModuleVersions({ moduleIds: eligible.map((module) => module.id) });
  const bookTypeById = new Map(wanted.map((book) => [book.id, book.book_type]));
  const moduleById = new Map(eligible.map((module) => [module.id, module]));

  const rows: RelatedVersion[] = [];
  const seen = new Set<string>();
  for (const version of versions) {
    if (seen.has(version.module_id)) continue;
    const moduleRow = moduleById.get(version.module_id);
    if (!moduleRow) continue;
    seen.add(version.module_id);
    rows.push({
      bookType: bookTypeById.get(moduleRow.book_id) ?? "unknown",
      moduleKey: moduleRow.module_key,
      moduleLabel: moduleRow.display_name,
      version,
      markdown: contentToMarkdown(version.content),
    });
  }

  if (!input.maxChars) return { versions: rows, omitted: 0 };

  const kept: RelatedVersion[] = [];
  let used = 0;
  for (const item of rows) {
    if (used + item.markdown.length > input.maxChars) continue;
    kept.push(item);
    used += item.markdown.length;
  }
  return { versions: kept, omitted: rows.length - kept.length };
}
