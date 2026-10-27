/**
 * 课时口径（跨书种共用）。
 *
 * 需求方 2026-10-27 确认：
 * - 春季 / 秋季（15 课）：第 5、10、15 课是复习课；
 * - 夏季 / 冬季（7 课）：第 7 课是复习课；
 * - **复习课没有知识清单**（其他三书照常）。
 *
 * 放成纯函数：制作页（客户端）与服务端共用同一份口径，不各写一套。
 */

import type { BookType, LessonType } from "./db/types.ts";
import type { Term } from "./types.ts";

export const REVISION_LESSONS_BY_TERM: Record<Term, readonly number[]> = {
  spring: [5, 10, 15],
  autumn: [5, 10, 15],
  summer: [7],
  winter: [7],
};

const REVISION_TITLE = /revision|复习/iu;

export function isRevisionLesson(term: string | null | undefined, lessonNumber: number): boolean {
  const lessons = term ? REVISION_LESSONS_BY_TERM[term as Term] : undefined;
  return Boolean(lessons?.includes(lessonNumber));
}

/**
 * 推断课型：课次口径优先，标题里的 Revision / 复习兜底。
 *
 * 标题兜底是为了防止学期选错时把复习课当常规课生成（春季第 5 课标题就是 Revision）。
 */
export function inferLessonType(input: {
  term: string | null | undefined;
  lessonNumber: number;
  title?: string | null;
}): LessonType {
  if (isRevisionLesson(input.term, input.lessonNumber)) return "revision";
  if (input.title && REVISION_TITLE.test(input.title)) return "revision";
  return "regular";
}

/** 复习课不产出的书种。 */
export function bookSupportsLessonType(bookType: BookType, lessonType: LessonType): boolean {
  return !(bookType === "knowledge" && lessonType === "revision");
}

const BOOK_LABEL: Record<BookType, string> = {
  student: "学生用书",
  workbook: "练习册",
  knowledge: "知识清单",
  vocab: "单词小超市",
};

export function unsupportedLessonMessage(bookType: BookType, lessonType: LessonType): string | null {
  if (bookSupportsLessonType(bookType, lessonType)) return null;
  return `复习课没有${BOOK_LABEL[bookType]}：春秋学期的复习课在第 5、10、15 课，夏冬学期在第 7 课。`;
}
