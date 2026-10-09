/**
 * 旧版来源解析的入口：按书种选解析器。
 *
 * 三个书种的旧版栏目名完全不同——
 *   知识清单：`# 第N讲` + `词汇复习` / `阅读词汇` / `语法复习`
 *   学生用书：`# UNIT N` + `Hello Vocabulary` / `Hello Reading` / `Hello Grammar` / `Hello Use of English`
 *   练习册：`Day N` 系列（见 `legacy-workbook.ts`）
 * 但产物都是同一套规范键（`LegacySectionKey`），所以模块目录的 `sourceSections` 通用。
 *
 * 分派放在这个单独的文件里，避免各解析器互相引用形成循环。
 */

import {
  splitLegacyKnowledgeMarkdown,
  type LegacyLessonPackage,
  type SplitLegacyOptions,
} from "./legacy-markdown.ts";
import { splitLegacyStudentBookMarkdown } from "./legacy-student-book.ts";
import { splitLegacyWorkbookMarkdown } from "./legacy-workbook.ts";

/**
 * 按书种解析旧版材料。
 *
 * 没有对应解析器的书种返回空数组——**不回退到别的书种的解析器**。
 * 用错解析器会切出一堆对不上号的栏目，比"没识别到"更难排查。
 */
export function splitLegacyMarkdown(
  markdown: string,
  bookType: string,
  options: SplitLegacyOptions = {},
): LegacyLessonPackage[] {
  switch (bookType) {
    case "student":
      return splitLegacyStudentBookMarkdown(markdown, options);
    case "workbook":
      return splitLegacyWorkbookMarkdown(markdown, options);
    case "knowledge":
      return splitLegacyKnowledgeMarkdown(markdown, options);
    default:
      return [];
  }
}
