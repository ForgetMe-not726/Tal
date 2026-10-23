/**
 * 资料库文件夹命名。
 *
 * 老师要在资源管理器里**一眼认出来**，所以不用任务 UUID：
 * `<学期>-<书种缩写>-ocr`，例如 `spring-sb-ocr`、`winter-kl-ocr`。
 * 重名（同一学期同一书种再次导入）自动加序号 `-2`、`-3`，不覆盖已有结果。
 *
 * 学期优先取老师选的；没选就从原文件名里认（寒假、2021 春1、秋下…），
 * 都认不出才退回 winter。书种以识别时选的为准，不看文件名——
 * 实测有把「学生用书」误选成知识清单的导入，文件名不可信。
 *
 * 本文件必须保持**纯函数**：识别页是客户端组件，也要用 `detectTerm` 认学期。
 * 需要读写磁盘的部分放在 `naming-disk.ts`。
 */

import type { BookType } from "../db/types.ts";
import { TERMS, type Term } from "../types.ts";

/** 文件夹里用的书种缩写：sb = student book，wb = workbook，kl = knowledge list。 */
export const BOOK_DIR_KEY: Record<BookType, string> = {
  student: "sb",
  workbook: "wb",
  knowledge: "kl",
  vocab: "vocab",
};

const TERM_KEYWORDS: Array<[Term, RegExp]> = [
  ["winter", /寒假|冬季|winter/iu],
  ["spring", /春季|春[0-9]?|spring/iu],
  ["summer", /暑假|夏季|summer/iu],
  ["autumn", /秋季|秋下|秋[0-9]|autumn|fall/iu],
];

export function normalizeTerm(value: unknown): Term | null {
  return typeof value === "string" && (TERMS as readonly string[]).includes(value)
    ? (value as Term)
    : null;
}

/** 从文件名里认学期；认不出返回 null（不猜）。 */
export function detectTerm(text: string | null | undefined): Term | null {
  if (!text) return null;
  for (const [term, pattern] of TERM_KEYWORDS) {
    if (pattern.test(text)) return term;
  }
  return null;
}

/** 分配一个未被占用的资料库文件夹名。`reserved` 由调用方带入已在用的名字。 */
export async function allocateLibraryDirName(
  term: Term,
  bookType: BookType,
  reserved: Set<string>,
): Promise<string> {
  const base = `${term}-${BOOK_DIR_KEY[bookType]}-ocr`;
  let candidate = base;
  for (let index = 2; reserved.has(candidate); index += 1) {
    candidate = `${base}-${index}`;
  }
  return candidate;
}
