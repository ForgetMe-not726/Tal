/**
 * 大纲「考试技能」列可能列多个剑桥题型（如 `Listening Part 1 / Speaking Part 3`）。
 *
 * 需求方 2026-10-27 确认：默认**只做一个题型**（取第一个）。
 * 完整列表仍保留在 profile 的 `examSkills` 里可追溯，`primaryExamSkill` 是实际使用的那个。
 */

/** 分隔符：斜杠、顿号、换行、分号；题型名内部不含这些符号。 */
const SEPARATORS = /[/、\n\r;；]+/u;

export function firstExamSkill(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value
    .split(SEPARATORS)
    .map((item) => item.trim())
    .find(Boolean);
  return first ?? null;
}
