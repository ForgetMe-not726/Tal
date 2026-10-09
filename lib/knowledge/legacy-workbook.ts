/**
 * 旧版**练习册**的栏目解析。
 *
 * 实测结论（`寒假练习册.pdf` 的 MinerU OCR，56 页）：
 * 旧版练习册与学生用书**用同一套栏目命名**——`Hello Vocabulary` / `Hello Grammar` /
 * `Hello Reading` / `Hello Listening` / `Hello Writing` / `Hello Use of English` /
 * `Hello Revision`，课边界是 `Unit N`。所以栏目映射直接复用学生用书那一套，
 * 只多一条 `Hello Revision`。
 *
 * **注意：`Day 1`–`Day 5` 是新版练习册的结构，不是旧版的。**
 * 旧版一课只有一组「词汇 + 语法」，新版把它铺成 Day 1–3 的滚动训练——
 * 对应关系是多对一，由模块目录的 `sourceSections` 表达，不在本文件里处理。
 *
 * 课边界来自**页眉**（`Unit 1`、`Unit 2`…），而引擎输出的 `.md` 会丢掉页眉。
 * 所以练习册必须用 `lib/knowledge/ocr-pages.ts` 重建的**带页码标记的 Markdown**
 * （`*_paged.md`）作为输入，否则整本连成一片、切不出课。
 */

import {
  splitIntoPackages,
  withoutBookWordList,
  type LegacyLessonPackage,
  type LegacySectionKey,
  type SectionRange,
  type SplitLegacyOptions,
} from "./legacy-markdown.ts";
import { studentBookSectionKey } from "./legacy-student-book.ts";

/**
 * 课边界。
 *
 * 重建后的 Markdown 里，课标题由 `buildPagedMarkdown` 生成，**固定是一级标题**
 * （`# Unit 1`）。这里只认一级，避免正文里出现的二级标题被误当成课边界——
 * 实测有 `## Unit 7 Revision unt / Revision` 这样的正文标题。
 */
const LESSON_HEADING = /^#\s*(?:Unit\s*(\d+)|Lesson\s*(\d+)|第\s*(\d+)\s*讲)[^\n]*$/gimu;

/** 只作来源、不参与生成的旧版讲次（旧版练习册没有这种情况）。 */
export const DEFAULT_SOURCE_ONLY_LESSONS: readonly number[] = [];

/** 只作来源的栏目：旧版有、新版练习册没有对应位置。 */
const SOURCE_ONLY_SECTIONS: readonly LegacySectionKey[] = ["notes", "consolidation"];

/**
 * 旧版练习册的栏目标题 → 规范键。
 *
 * 与学生用书共用 `Hello X` 映射，只补一条 `Hello Revision`。
 */
export function workbookSectionKey(heading: string): LegacySectionKey {
  const normalized = heading.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("hellorevision")) return "revision";
  return studentBookSectionKey(heading);
}

/**
 * 复习单元（`# Unit 7`）的编号题：`## ① All the words have the /i:/ sound…`。
 *
 * 它是**整课复习**，用带圈数字编号，没有 `Hello X` 栏目名——所以按栏目名判定时
 * 整讲一个来源块都切不出来，复习课因此报「没有可生成的内容」。
 */
const NUMBERED_EXERCISE = /^#{1,2}[ \t]*[①-⑳]/u;

/**
 * 把复习单元的编号题切成来源块。
 *
 * **只在这一讲没有任何内容栏目时才认**：常规单元的 `## ①a Choose the correct letters…`
 * 是 `Hello Vocabulary` **内部**的小题号，认成栏目会把整个词汇栏目切断。
 * 判据因此不是"标题长什么样"，而是"这一讲有没有 Hello X 栏目"——常规单元有，复习单元没有。
 *
 * 切出来的键统一是 `revision`（整课复习材料），**不在解析器里判断哪道题是词汇、
 * 哪道是语法**：那是语义判断，由复习课的骨架交给模型做（见模块目录里 day_1/day_5 的
 * `revisionOutline`）。解析器硬猜题型等于把某一册的题序写死进代码。
 */
function recoverRevisionExercises(input: {
  identified: readonly SectionRange[];
  rawText: string;
}): SectionRange[] {
  const contentSections: readonly LegacySectionKey[] = ["objectives", "explore", "say", "read", "talk", "use"];
  if (input.identified.some((item) => contentSections.includes(item.key))) return [];

  const lines = input.rawText.split("\n");
  const starts: Array<{ start: number; label: string }> = [];
  let offset = 0;
  for (const line of lines) {
    if (NUMBERED_EXERCISE.test(line)) {
      starts.push({ start: offset, label: line.replace(/^#{1,2}\s*/, "").trim() });
    }
    offset += line.length + 1;
  }
  if (starts.length === 0) return [];

  return starts.map((item, index) => ({
    key: "revision" as const,
    label: item.label,
    start: item.start,
    end: starts[index + 1]?.start ?? input.rawText.length,
  }));
}

export function splitLegacyWorkbookMarkdown(
  markdown: string,
  options: SplitLegacyOptions = {},
): LegacyLessonPackage[] {
  const sourceOnlyLessons = options.sourceOnlyLessons ?? DEFAULT_SOURCE_ONLY_LESSONS;
  // 不需要命名边界：练习册的复习单元有正常的一级标题 `# Unit 7`。
  return splitIntoPackages(
    withoutBookWordList(markdown),
    LESSON_HEADING,
    workbookSectionKey,
    (lessonNumber, key) => sourceOnlyLessons.includes(lessonNumber) || SOURCE_ONLY_SECTIONS.includes(key),
    "legacy-wb",
    { recover: recoverRevisionExercises },
  );
}
