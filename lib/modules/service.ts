import { getAppStore } from "@/lib/db/store";
import type { BookType, LessonType, ModuleDefinitionRow } from "@/lib/db/types";
import {
  ModuleDirectoryError,
  findModuleOutline,
  resolveModuleOutline,
  type ModuleOutline,
} from "@/lib/modules/directory";

/**
 * 模块目录的**取数层**。
 *
 * 目录内容与合并规则在 `directory.ts`（纯函数、可单测）；这里只负责读库。
 */

export class ModuleDefinitionServiceError extends Error {}

export { resolveModuleOutline, ModuleDirectoryError };

export async function listModuleDefinitions(
  bookType?: BookType,
  lessonType?: LessonType,
): Promise<ModuleDefinitionRow[]> {
  try {
    const rows = await getAppStore().listModuleDefinitions(bookType);
    if (!lessonType) return rows;
    return rows.filter((row) => lessonTypesOf(row).includes(lessonType));
  } catch (error) {
    throw new ModuleDefinitionServiceError(`读取模块目录失败:${(error as Error).message}`);
  }
}

/**
 * 该目录项适用的课型。
 *
 * 优先读 `payload.lessonTypes`（数据库可覆盖）；没写就按出厂默认：
 * 学生用书的 explore/read 只在常规课出现，其余两课型通用。
 */
function lessonTypesOf(row: ModuleDefinitionRow): LessonType[] {
  const declared = row.payload?.lessonTypes;
  if (Array.isArray(declared)) {
    const valid = declared.filter(
      (item): item is LessonType => item === "regular" || item === "revision",
    );
    if (valid.length > 0) return valid;
  }
  return findModuleOutline(row.book_type, row.module_key)?.lessonTypes ?? ["regular", "revision"];
}

/**
 * 按书种与模块标识取模块定义；目录里没有该模块直接报错，不静默回退。
 *
 * `lessonType` 决定用哪份骨架：复习课的小节结构与常规课不同（见
 * `resolveModuleOutline`）。默认常规课，保持既有调用方行为不变。
 */
export async function resolveModuleOutlineByKey(
  bookType: BookType,
  moduleKey: string,
  lessonType: LessonType = "regular",
): Promise<ModuleOutline> {
  const rows = await getAppStore().listModuleDefinitions(bookType);
  const row = rows.find((item) => item.module_key === moduleKey);
  if (row) return resolveModuleOutline(row, lessonType);

  // 目录里没有这条（例如演示模式下还没导入）：出厂默认里查得到就用它，否则报错。
  const fallback = findModuleOutline(bookType, moduleKey);
  if (!fallback) {
    throw new ModuleDefinitionServiceError(`${bookType} 书种的模块目录里没有 ${moduleKey}`);
  }
  return lessonType === "revision" && fallback.revisionOutline
    ? { ...fallback, outline: fallback.revisionOutline }
    : fallback;
}
