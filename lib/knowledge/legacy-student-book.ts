/**
 * 旧版**学生用书**的栏目解析。
 *
 * 旧版学生用书与旧版知识清单的栏目名完全不同，所以各有一套解析器，
 * 但都归到同一套规范键（`LegacySectionKey`），于是模块目录里的 `sourceSections`
 * 对两个书种都能直接用，取来源时不需要按书种分支。
 *
 * 实测旧版 OCR 的标题形如：
 *   `# UNIT1 Fond memories`、`# UNIT2`、`# 第6讲 …`
 *   `## I can`、`## DIDYOU KNOW...?`、`## Hello Vocabulary`、`## Hello Reading`、
 *   `## Hello Grammar`、`## Hello Use of English`、`## Hello Listening`…
 *
 * OCR 噪声（`DIDYOU KNOW...?` 缺空格、`LOOKE` 应为 LOOK!、`4Read` 缺空格）只影响
 * 栏目内的正文，不影响栏目边界识别——归一化时去掉所有非字母字符再比对。
 */

import {
  splitIntoPackages,
  withoutBookWordList,
  type LegacyLessonPackage,
  type LegacySectionKey,
  type SectionKeyContext,
  type SectionRange,
  type SplitLegacyOptions,
} from "./legacy-markdown.ts";

/**
 * 课边界。
 *
 * 旧版学生用书按 `UNIT N` 编号（与部门大纲「旧版 Unit」一致），
 * 但也接受 `第N讲` —— 两册书的 MinerU 标题不统一。
 * MinerU 有时把标题挤到下一行（`# UNIT2` 单独成行），这不影响边界，只影响课标题文字。
 */
const LESSON_HEADING = /^#{1,2}\s*(?:UNIT\s*(\d+)|第\s*(\d+)\s*讲)[^\n]*$/gimu;

/**
 * 复习单元的起始标题。
 *
 * 旧版学生用书目录页写的是 `Unit 7 Revision 112`，但**正文里没有 `UNIT 7` 标题**——
 * 复习单元从 `Vocabulary Revision` 直接开始。不给它一个边界，它的内容就会整块
 * 落在第 6 讲里：实测第 6 讲的 `use` 因此膨胀到 26858 字，`read` 还会拿到
 * 复习单元的阅读文章（而部门大纲里 Lesson 5（原 Unit 6）的「阅读」本来是空的）。
 */
const REVISION_UNIT_HEADING = /^#{1,2}\s*Vocabulary\s+Revision[^\n]*$/gimu;

/** 复习单元在旧版里的讲次号（目录页 `Unit 7 Revision`）。 */
const REVISION_UNIT_NUMBER = 7;

/**
 * 只作来源、不参与生成的旧版讲次。
 *
 * 曾经是 `[7]`：那时复习单元没有独立边界、且不确定要不要生成复习课（Q-SB-004）。
 * 现在复习单元已经是独立的一讲、复习课也确定要生成，所以不再整讲排除。
 * 换册次时仍可用 `SplitLegacyOptions.sourceOnlyLessons` 覆盖。
 */
export const DEFAULT_SOURCE_ONLY_UNITS: readonly number[] = [];

/**
 * 只作来源的栏目。
 *
 * 学生用书的复习单元栏目**不在这里**：它们有独立边界，且复习课的模块需要它们
 * （`Vocabulary Revision` → say、`Grammar Revision` → talk、`* Practice` → use）。
 * `notes` / `consolidation` 目前没有产生者，留在这里是为了万一出现时默认不生成。
 */
const SOURCE_ONLY_SECTIONS: readonly LegacySectionKey[] = ["notes", "consolidation"];

/**
 * 标题是否是某个 `Hello X` 栏目。
 *
 * 容忍 OCR 的两类噪声：
 * - **吞掉首字母 H**：实测旧版练习册同时出现 `Hello Vocabulary` 与 `ello Vocabulary`、
 *   `Hello Writing` 与 `ello Writing`。
 * - **前面多出噪声字符**：实测学生用书 Unit 5 的 `Hello Use of English` 被读成
 *   `I Hello Use of English`，整条栏目因此消失。
 *
 * 所以按「以 `Hello X` 结尾」判断，而不是全等。
 */
function isHello(normalized: string, name: string): boolean {
  // `name` 是**去掉首字母 H 之后**的写法（`elloworld`），完整名是 `h${name}`。
  return normalized === name || normalized.endsWith(`h${name}`);
}

/** 学生用书里承载正式内容的栏目——话题引入一定排在它们之前。 */
const CONTENT_SECTIONS: readonly LegacySectionKey[] = ["say", "read", "talk", "use", "revision"];

/**
 * 旧版学生用书的栏目标题 → 规范键。
 *
 * 先把标题压成纯小写字母再比对，避免 OCR 的空格/标点差异（`DIDYOU KNOW...?`）。
 * 旧版**练习册**用同一套 `Hello X` 命名，直接复用本函数（见 `legacy-workbook.ts`）。
 */
export function studentBookSectionKey(
  heading: string,
  context?: SectionKeyContext,
): LegacySectionKey {
  const n = heading.toLowerCase().replace(/[^a-z]/g, "");

  // 「I can」是本课能做到的能力描述 → 新版主题页的课时目标
  if (n === "ican") return "objectives";
  // 「Did you know…?」+「Hello World」都是话题引入的科普短文 → Let's explore!
  //
  // 但 `DID YOU KNOW?` 也是**栏目内部的杂志小标题**：实测学生用书 Unit 3 的
  // Hello Vocabulary 跨页里就有一个，它下面是一整页词汇呈现短文。若照认，
  // Hello Vocabulary 会在那里被切断——say 只剩 863 字，一整页词汇跑进 explore。
  // 判据是位置：话题引入一定在第一个内容栏目之前，栏目内部的小标题在之后。
  if (n.startsWith("didyouknow")) {
    const seen = context?.seenKeys ?? [];
    return seen.some((key) => CONTENT_SECTIONS.includes(key)) ? "other" : "explore";
  }
  if (isHello(n, "elloworld")) return "explore";

  // 复习单元的栏目。它们复用常规栏目的键，因为**复习课的模块就是这几个**：
  // 复习单元的独立边界保证它们不会串进常规单元（见 REVISION_UNIT_HEADING）。
  if (n.includes("vocabularyrevision")) return "say";
  if (n.includes("grammarrevision")) return "talk";
  if (n.includes("readingpractice")) return "read";
  if (n.includes("listeningpractice")) return "use";
  if (n.includes("speakingpractice")) return "use";

  if (isHello(n, "ellovocabulary")) return "say";
  if (n.includes("developyourvocabulary")) return "say";

  if (isHello(n, "elloreading")) return "read";

  if (isHello(n, "ellogrammar")) return "talk";

  // 听力/口语/写作不再单设栏目，全部并入 Let's use!
  if (isHello(n, "ellouseofenglish")) return "use";
  if (isHello(n, "ellolistening")) return "use";
  if (isHello(n, "ellospeaking")) return "use";
  if (isHello(n, "ellowriting")) return "use";

  // 注意：`Exam tip` / `Exam information` **不能**当成顶级栏目边界。
  //
  // 它们出现在栏目内部（Hello Reading 下有自己的 Exam tip，Hello Use of English 下有
  // Exam information）。若把它们映射成 use，`Hello Reading` 会在 Exam tip 处被切断——
  // 实测后果是 read 栏目只剩 240 字的导入语，而**整篇课文（# Beatful 与 A/B/C/D 四段
  // 人物自述）被并进了 use**，阅读模块拿不到文章。
  //
  // 返回 other 表示"不是边界"，它们会留在所属栏目的正文里，
  // 于是 Hello Reading 下的 Exam tip 随 read 走，Hello Use of English 下的随 use 走。
  return "other";
}

/** 恢复出来的栏目至少要有这么多正文字符；不够就说明这一课本来没有该栏目。 */
const MIN_RECOVERED_CHARS = 120;

/** `I can` 的能力清单：OCR 把项目符号读成 `--`，也有 `-`、`•`、`1.` 的写法。 */
const BULLET_LINE = /^\s*(?:--+|[-*•·]|\d+[.)])\s+\S/u;

/** 去掉图片标记与空白后的正文长度——图片不算内容，不能拿来凑数。 */
function textLength(markdown: string): number {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\s/gu, "")
    .length;
}

/**
 * 补出标题丢失的 `Hello World` 栏目（旧版话题引入 → 新版 Let's explore!）。
 *
 * 实测学生用书 Unit 2 的 `Hello World` 是一整幅跨页横幅，MinerU 切得出科普短文、
 * 切不出标题文字，于是短文落进了 `I can`（objectives）栏目里，
 * `lets_explore` 因此取不到来源、生成直接报错（其余单元都有 `Hello World` 或
 * `Did you know…?` 标题，所以只有部分课时出问题）。
 *
 * 判据是旧版单元的固定结构：`I can` 标题之后是一串能力清单（`-- …`），
 * 清单结束、下一个 `Hello X` 之前的正文就是话题引入。不靠关键词猜——
 * 每个单元的话题短文标题都不一样。
 */
function recoverExploreSection(input: {
  lessonNumber: number;
  rawText: string;
  identified: readonly SectionRange[];
}): SectionRange[] {
  const { rawText, identified } = input;
  if (identified.some((item) => item.key === "explore")) return [];
  const objectives = identified.find((item) => item.key === "objectives");
  if (!objectives) return [];

  const lines = rawText.slice(objectives.start, objectives.end).split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }

  // 第 0 行是 `## I can` 标题；跳过空行后必须直接是能力清单。
  // 不是这个结构就说明这一课的 `I can` 与预期不同，宁可不猜。
  let index = 1;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index >= lines.length || !BULLET_LINE.test(lines[index])) return [];
  // 清单之后的正文就是话题引入；清单走到课尾（后面紧跟下一个栏目标题）则没有可补的。
  while (index < lines.length && (BULLET_LINE.test(lines[index]) || !lines[index].trim())) index += 1;
  if (index >= lines.length) return [];

  const tail = lines.slice(index).join("\n").trim();
  if (textLength(tail) < MIN_RECOVERED_CHARS) return [];

  return [{
    key: "explore",
    label: "Hello World",
    start: objectives.start + offsets[index],
    end: objectives.end,
  }];
}

export function splitLegacyStudentBookMarkdown(
  markdown: string,
  options: SplitLegacyOptions = {},
): LegacyLessonPackage[] {
  const sourceOnlyUnits = options.sourceOnlyLessons ?? DEFAULT_SOURCE_ONLY_UNITS;
  return splitIntoPackages(
    withoutBookWordList(markdown),
    LESSON_HEADING,
    studentBookSectionKey,
    (lessonNumber, key) => sourceOnlyUnits.includes(lessonNumber) || SOURCE_ONLY_SECTIONS.includes(key),
    "legacy-sb",
    {
      recover: recoverExploreSection,
      // 复习单元没有 `UNIT 7` 标题，只有 `Vocabulary Revision` 这样的栏目名。
      namedLessons: [{ heading: REVISION_UNIT_HEADING, lessonNumber: REVISION_UNIT_NUMBER }],
    },
  );
}
