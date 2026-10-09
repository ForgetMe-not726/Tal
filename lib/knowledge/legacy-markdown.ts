import { htmlTablesToMarkdown } from "../markdown/html-tables.ts";

/**
 * 旧版栏目的**规范键**，按新版模块语义命名。
 *
 * 旧版知识清单和学生用书的原始栏目标题完全不同（「词汇复习」vs「Hello Vocabulary」），
 * 但都归到同一套规范键上——这样模块目录里的 `sourceSections` 对两个书种都能直接用，
 * 取来源时不需要再按书种分支。
 */
export type LegacySectionKey =
  /** 课时目标（旧版 `I can`） */
  | "objectives"
  /** Let's explore!（旧版 `Did you know…?` + `Hello World`） */
  | "explore"
  /** Let's say!（旧版 `词汇复习` / `Hello Vocabulary` / `Vocabulary Revision`） */
  | "say"
  /** Let's read!（旧版 `阅读词汇` / `Hello Reading` / `Reading Practice`） */
  | "read"
  /** Let's talk!（旧版 `语法复习` / `Hello Grammar` / `Grammar Revision`） */
  | "talk"
  /** Let's use!（旧版 `Hello Use of English` / `Listening` / `Speaking` / `Writing` 及各 Practice） */
  | "use"
  /**
   * 复习课的内容（旧版 `Vocabulary Revision` / `Grammar Revision`）。
   *
   * 单独成一个键，因为它属于**复习单元**而不是当册的常规单元：
   * 旧版 OCR 里复习单元常常没有独立标题，若并进 `say`/`talk`，
   * 复习内容会被当成上一个单元的课程来源混进正文。默认只作来源。
   */
  | "revision"
  /**
   * 练习册按 `Day` 分块，所以来源粒度也是 Day。
   *
   * 不能复用 `say`/`talk`：Day 1、Day 2、Day 3 都含词汇与语法，
   * 三天会同时命中同一批 `say` 候选而互相串内容。用 Day 作键，
   * 每个模块只取自己那一天的材料（见 `legacy-workbook.ts`）。
   */
  | "day_1"
  | "day_2"
  | "day_3"
  | "day_4"
  | "day_5"
  /** 手写区，新版没有对应位置 */
  | "notes"
  /** 巩固建议，新版没有对应位置 */
  | "consolidation"
  | "other";

/**
 * 判定栏目标题时能看到的**位置上下文**。
 *
 * 有些栏目标题只在单元开头成立：`Did you know…?` 是话题引入，但同一个写法
 * 也会作为**栏目内部的小标题**出现（实测学生用书 Unit 3 的 Hello Vocabulary
 * 跨页里就有一个 `DID YOU KNOW?` 杂志小标题）。只看标题文字分不开这两种，
 * 所以把「这一课已经开过哪些栏目」交给书种自己判断。
 */
export type SectionKeyContext = {
  /** 本课在此标题之前已经识别出的栏目，按正文顺序。 */
  seenKeys: readonly LegacySectionKey[];
};

export type LegacySourceCandidate = {
  id: string;
  sourceLessonNumber: number;
  sourceHeading: string;
  sectionKey: LegacySectionKey;
  sectionLabel: string;
  rawText: string;
  lineStart: number;
  lineEnd: number;
  sourceRef: string;
  sourceOnly: boolean;
};

export type LegacyLessonPackage = {
  sourceLessonNumber: number;
  sourceHeading: string;
  rawText: string;
  candidates: LegacySourceCandidate[];
};

const LESSON_HEADING = /^#{1,2}\s*第\s*(\d+)\s*讲[^\n]*$/gmu;
/**
 * 栏目标题。**一级和二级都要认**：MinerU 对同一套栏目名给的层级并不稳定——
 * 实测学生用书 Unit 3 的 `Hello Use of English`、Unit 5 的 `Did you know...?`
 * 与 `Hello Vocabulary` 都被排成了一级标题。只认 `##` 会让这些栏目整块消失，
 * 对应模块取不到来源、生成直接报错。
 *
 * 放宽不会误切：真正属于正文的一级标题（课文标题 `# Beatful`、单元名 `# UNIT2`）
 * 在 `keyOf` 里都返回 `other`，会被下面的 filter 去掉。
 */
const SECTION_HEADING = /^#{1,2}\s+(.+)$/gmu;

function lineNumber(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** 旧版知识清单的栏目标题 → 规范键。 */
function sectionKey(heading: string): LegacySectionKey {
  const normalized = heading.replace(/[：:。\s]/gu, "").toLocaleLowerCase();
  if (normalized.includes("词汇复习")) return "say";
  if (normalized.includes("阅读词汇") || normalized.includes("阅读词汇及短语")) return "read";
  if (normalized.includes("语法复习")) return "talk";
  if (normalized.includes("yournotes")) return "notes";
  if (normalized.includes("巩固建议")) return "consolidation";
  return "other";
}

/**
 * 只作来源、不参与生成的旧版讲次。
 *
 * **知识清单**用这个默认值：新版 2.0 样本里没有独立的 Revision 知识清单课时，
 * 所以旧版复习性课时不生成目标正文（依据见
 * `docs/drafts/迁移对应关系-知识清单-初拟.md` §「复习性课时」）。
 * 这是**教研决定而不是通用结构**，换册次时通过 `SplitLegacyOptions.sourceOnlyLessons`
 * 覆盖；正式规则到位后应改由规则库或大纲提供。
 */
export const DEFAULT_SOURCE_ONLY_LESSONS: readonly number[] = [7];

/**
 * 只作来源的栏目。
 *
 * - `notes` / `consolidation`：新版知识清单里没有对应位置。
 * - `revision`：复习单元里**没有新模块承接**的栏目（旧版练习册每课末尾的
 *   `Hello Revision` 就属于这种）。学生用书的复习单元有独立边界，它的栏目走
 *   say/talk/read/use，不用这个键（见 `legacy-student-book.ts`）。
 */
const SOURCE_ONLY_SECTIONS: readonly LegacySectionKey[] = ["notes", "consolidation", "revision"];

export type SplitLegacyOptions = {
  /** 覆盖默认的“只作来源讲次”清单。 */
  sourceOnlyLessons?: readonly number[];
};

/**
 * 书末 `Word List` 的起始行。
 *
 * 它是**书级附录**（新版对应 `Appendix: Words & Expressions`），不属于任何一课。
 * MinerU 对两个书种给的写法不同：学生用书是一行 `Unit 1 Fond memories Vocabulary`
 * 加词表（没有标题），练习册是 `## Word List`。不切掉的话，整本书的词表会被当成
 * 最后一课最后一个栏目的正文——实测学生用书复习课的 `Let's use!` 会拿到 17912 字的
 * `Speaking Practice`，练习册复习单元的 ⑤ 会连带整本书的词表。
 *
 * 词表本身没有丢：整份 OCR 原文仍作为 `sourceRawText` 存在项目里，
 * 书级附录是另一个模块，等它立项时再从原文取。
 */
const WORD_LIST_START = /^(?:#{1,3}\s*Word\s*List[ \t]*|Unit\s*\d+[^\n]*Vocabulary[ \t]*)$/imu;

/** 切掉书末词表，只把「课」的部分交给切分器。 */
export function withoutBookWordList(markdown: string): string {
  const match = WORD_LIST_START.exec(markdown);
  return match?.index != null ? markdown.slice(0, match.index) : markdown;
}

/**
 * 没有课号的课边界。
 *
 * 旧版**复习单元**（学生用书 Unit 7）在 OCR 里没有 `UNIT 7` 标题——正文里只有
 * 栏目名（`Vocabulary Revision`）。要把它切成独立的一讲、让复习课的模块取到来源，
 * 就得由书种声明「哪个标题等于第几讲」。
 */
export type NamedLessonBoundary = {
  heading: RegExp;
  lessonNumber: number;
};

/** 一个栏目在本课正文里的区间（相对该课 rawText 的字符偏移）。 */
export type SectionRange = {
  key: LegacySectionKey;
  label: string;
  start: number;
  end: number;
};

/**
 * 补出**标题整块丢失**的栏目。
 *
 * 有些栏目的标题在旧版书里是图形化的（实测学生用书 Unit 2 的 `Hello World`
 * 是一整幅跨页横幅），MinerU 只切得出正文、切不出标题文字。于是这段内容既不是
 * 任何栏目标题、就落进了上一个栏目的正文里，对应模块取不到来源、生成直接报错。
 *
 * 补法不能靠关键词猜（每个单元的话题短文标题都不一样），只能靠**书种自己的固定结构**，
 * 所以做成钩子交给书种解析器：输入是本课已识别栏目的区间，输出要额外切出的区间。
 * 返回的区间会被合并进候选列表；因为候选正文是「本栏目起点到下一个栏目起点」，
 * 落在某个栏目区间内部的补丁会**自动把那个栏目截短**（`I can` 的能力清单归 objectives，
 * 其后的短文归 explore）。
 */
export type SectionRecovery = (input: {
  lessonNumber: number;
  rawText: string;
  identified: readonly SectionRange[];
}) => SectionRange[];

function sourceOnlyFor(
  sourceLessonNumber: number,
  key: LegacySectionKey,
  options: SplitLegacyOptions,
): boolean {
  const lessons = options.sourceOnlyLessons ?? DEFAULT_SOURCE_ONLY_LESSONS;
  return lessons.includes(sourceLessonNumber) || SOURCE_ONLY_SECTIONS.includes(key);
}

export type SplitIntoPackagesOptions = {
  /** 补出标题丢失的栏目。 */
  recover?: SectionRecovery;
  /** 没有课号的课边界（旧版复习单元）。 */
  namedLessons?: readonly NamedLessonBoundary[];
};

/** 一节课的边界：位置、标题文字、课号。 */
type LessonBoundaryMatch = {
  index: number;
  heading: string;
  lessonNumber: number;
};

/**
 * 收集课边界。
 *
 * 两种来源合并后按位置排序：带课号的标题（`UNIT 3`、`第3讲`）和**不带课号的命名边界**
 * （旧版复习单元只有 `Vocabulary Revision`，课号由书种声明）。
 *
 * 命名边界是**兜底**：某一讲在正文里已经有带课号的标题时，它的命名边界一律忽略。
 * 否则同一讲会被切出两个包——有的册次复习单元写了 `UNIT 7`，有的没写，
 * 两种写法都得对。
 */
function collectLessonBoundaries(
  markdown: string,
  lessonHeading: RegExp,
  namedLessons: readonly NamedLessonBoundary[],
): LessonBoundaryMatch[] {
  const numbered: LessonBoundaryMatch[] = [];
  for (const match of markdown.matchAll(lessonHeading)) {
    // 课边界正则可能有多个分支（如 `UNIT N` 与 `第N讲`），取第一个匹配到的数字组。
    const digits = match.slice(1).find((group) => group != null && group !== "");
    const lessonNumber = Number(digits);
    // 认不出课号的标题（例如 `# Hello Use of English` 之类）不能当课边界。
    if (!Number.isInteger(lessonNumber)) continue;
    numbered.push({ index: match.index ?? 0, heading: (match[0] ?? "").trim(), lessonNumber });
  }

  const numberedLessons = new Set(numbered.map((item) => item.lessonNumber));
  const named: LessonBoundaryMatch[] = [];
  for (const boundary of namedLessons) {
    if (numberedLessons.has(boundary.lessonNumber)) continue;
    for (const match of markdown.matchAll(boundary.heading)) {
      named.push({
        index: match.index ?? 0,
        heading: (match[0] ?? "").trim(),
        lessonNumber: boundary.lessonNumber,
      });
    }
  }
  return [...numbered, ...named].sort((a, b) => a.index - b.index);
}

/**
 * 按「课」和「栏目」把一个旧版文档切成来源包。
 *
 * 两个书种共用这一段：差别只在课边界怎么写、栏目标题怎么映射到规范键。
 * 栏目内部的子标题（四会词汇、搭配、拓展…）属于该栏目的正文，必须一起取走，
 * 否则会得到空栏目。
 */
export function splitIntoPackages(
  markdown: string,
  lessonHeading: RegExp,
  keyOf: (label: string, context: SectionKeyContext) => LegacySectionKey,
  isSourceOnly: (lessonNumber: number, key: LegacySectionKey) => boolean,
  idPrefix: string,
  options: SplitIntoPackagesOptions = {},
): LegacyLessonPackage[] {
  const recover = options.recover;
  const lessons = collectLessonBoundaries(markdown, lessonHeading, options.namedLessons ?? []);
  return lessons.map((lessonMatch, lessonIndex) => {
    const sourceLessonNumber = lessonMatch.lessonNumber;
    const start = lessonMatch.index;
    const end = lessons[lessonIndex + 1]?.index ?? markdown.length;
    // `lessonText` 是**原始**切片：所有区间偏移都相对它计算，所以不能在切片前转换。
    // 交给调用方的是转换后的文本（见文件头的 htmlTablesToMarkdown 说明）。
    const lessonText = markdown.slice(start, end).trim();
    const sourceHeading = lessonMatch.heading;

    // 只有识别得出的顶层栏目才切分，其余标题留在原栏目正文里。
    // 逐个判定并累积 seenKeys——栏目标题的含义可能取决于它出现在哪里（见 SectionKeyContext）。
    const identified: SectionRange[] = [];
    const seenKeys: LegacySectionKey[] = [];
    for (const match of lessonText.matchAll(SECTION_HEADING)) {
      const label = (match[1] ?? "").trim();
      const key = keyOf(label, { seenKeys });
      if (key === "other") continue;
      identified.push({ key, label, start: match.index ?? 0, end: lessonText.length });
      seenKeys.push(key);
    }
    for (let index = 0; index < identified.length; index += 1) {
      identified[index].end = identified[index + 1]?.start ?? lessonText.length;
    }

    // 补出来的栏目按位置合并：同一个起点只保留一个（补丁与已识别栏目重叠时以已识别的为准）。
    const recovered = (recover?.({ lessonNumber: sourceLessonNumber, rawText: lessonText, identified }) ?? [])
      .filter((item) => item.start >= 0 && item.end > item.start)
      .filter((item) => !identified.some((known) => known.start === item.start));
    const boundaries = [...identified, ...recovered].sort((a, b) => a.start - b.start);

    const candidates: LegacySourceCandidate[] = [];
    for (let index = 0; index < boundaries.length; index += 1) {
      const boundary = boundaries[index];
      const sectionEnd = boundaries[index + 1]?.start ?? lessonText.length;
      const sectionText = htmlTablesToMarkdown(lessonText.slice(boundary.start, sectionEnd).trim());
      if (!sectionText) continue;
      const absoluteStart = start + boundary.start;
      const absoluteEnd = start + sectionEnd;
      candidates.push({
        id: `${idPrefix}:${sourceLessonNumber}:${boundary.key}:${lineNumber(lessonText, boundary.start)}`,
        sourceLessonNumber,
        sourceHeading,
        sectionKey: boundary.key,
        sectionLabel: boundary.label,
        rawText: sectionText,
        lineStart: lineNumber(markdown, absoluteStart),
        lineEnd: lineNumber(markdown, Math.max(absoluteStart, absoluteEnd - 1)),
        sourceRef: `${idPrefix}:lesson-${sourceLessonNumber}:${boundary.key}`,
        sourceOnly: isSourceOnly(sourceLessonNumber, boundary.key),
      });
    }
    // 交给调用方的是转换后的正文：HTML 表格换成 Markdown 表格（见 htmlTablesToMarkdown）。
    return {
      sourceLessonNumber,
      sourceHeading,
      rawText: htmlTablesToMarkdown(lessonText),
      candidates,
    };
  });
}

export function splitLegacyKnowledgeMarkdown(
  markdown: string,
  options: SplitLegacyOptions = {},
): LegacyLessonPackage[] {
  return splitIntoPackages(
    markdown,
    LESSON_HEADING,
    sectionKey,
    (lessonNumber, key) => sourceOnlyFor(lessonNumber, key, options),
    "legacy",
  );
}

/**
 * 解析目标 Lesson 对应的旧版讲次。
 *
 * 默认规则：教材迁移按课时编号一一对应（Lesson N ← 旧第 N 讲）。
 * 只有部门大纲的单元格写了变更标注（例如「（原Unit 6）」）时才覆盖默认值。
 * 标注与默认值都以大纲为准，不需要用户在工作台二次确认。
 */
export function sourceUnitForTargetLesson(lesson: {
  lessonNumber: number;
  mappings: Array<{ source?: string | null; status: string; legacySourceUnit?: number }>;
}): number | null {
  const annotated = lesson.mappings.find((item) => item.legacySourceUnit);
  if (annotated?.legacySourceUnit) return annotated.legacySourceUnit;
  return Number.isInteger(lesson.lessonNumber) && lesson.lessonNumber > 0 ? lesson.lessonNumber : null;
}

export function filterLegacyCandidatesForLesson(
  packages: LegacyLessonPackage[],
  sourceLessonNumber: number | null,
): LegacySourceCandidate[] {
  if (sourceLessonNumber == null) return [];
  return packages
    .filter((item) => item.sourceLessonNumber === sourceLessonNumber)
    .flatMap((item) => item.candidates)
    .filter((candidate) => !candidate.sourceOnly);
}

/** 某一讲的来源块统计，用来生成准确的「为什么取不到来源」提示。 */
export type LessonSourceStats = {
  /** 可参与生成的栏目块数。 */
  usable: number;
  /** 只作来源的栏目块数。 */
  sourceOnly: number;
  /** 这一讲有没有正文。 */
  hasText: boolean;
};

/**
 * 统计某一讲的来源块。
 *
 * 「没有可生成内容」有四种不同的原因，给老师的提示也不一样：整讲为空、
 * 栏目都在但**都只作来源**（旧版有、新版没有对应位置，如知识清单的巩固建议）、
 * 有正文但栏目结构对不上（旧版练习册 Unit 7 是整课复习，题目标题是
 * `## ① All the words have…`，认不出栏目）、以及这一课旧版本来就没有该栏目。
 */
export function lessonSourceStats(
  packages: LegacyLessonPackage[],
  sourceLessonNumber: number | null,
): LessonSourceStats {
  if (sourceLessonNumber == null) return { usable: 0, sourceOnly: 0, hasText: false };
  const candidates = packages
    .filter((item) => item.sourceLessonNumber === sourceLessonNumber)
    .flatMap((item) => item.candidates);
  const hasText = packages
    .filter((item) => item.sourceLessonNumber === sourceLessonNumber)
    .some((item) => item.rawText.trim().length > 0);
  return {
    usable: candidates.filter((item) => !item.sourceOnly).length,
    sourceOnly: candidates.filter((item) => item.sourceOnly).length,
    hasText,
  };
}
