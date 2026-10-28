/**
 * 决定「某个模块该拿哪段旧版来源文本」。
 *
 * 这段逻辑原先埋在工作台组件里，无法单测，结果踩过一次坑：
 * 判断"课时目标是否只依赖大纲"时看的是 `sourceSections` 是否含 objectives，
 * 而知识清单的 learning_objectives 的 sourceSections 是空的（只有学生用书是
 * `["objectives"]`），于是导入过旧版 OCR 后它取不到来源、生成直接报错。
 *
 * 现在提成纯函数：判据是模块目录的 `deterministic` 字段，
 * 并且有回归测试盯着两个书种各自的课时目标。
 */

import type {
  LegacySectionKey,
  LegacySourceCandidate,
  LessonSourceStats,
} from "./legacy-markdown.ts";

export type SourceSelectionModule = {
  sourceSections?: LegacySectionKey[];
  /** 有值表示该模块由大纲确定性生成，不依赖旧版材料。 */
  deterministic?: string;
};

export type OutlineSourceLesson = {
  lessonNumber: number;
  title: string;
  theme?: string | null;
  coreVocabulary?: string | null;
  reading?: string | null;
  grammar?: string | null;
  examSkills?: string | null;
};

export type SourceSelectionInput = {
  module: SourceSelectionModule | undefined;
  /** 当前 Lesson 下可用的旧版来源块（已按 Lesson 过滤、已剔除只作来源的块）。 */
  candidates: LegacySourceCandidate[];
  outlineLesson: OutlineSourceLesson | null;
  /** 是否导入过旧版材料（用于区分"没导入"和"导入了但没有对应栏目"）。 */
  hasLegacyPackages: boolean;
  /** 未按讲次切分时的整份原文兜底。 */
  rawSourceText: string;
};

/**
 * 把大纲的课时目标字段拼成模型可读的来源文本。
 *
 * 字段为空（含只有空白）时**整行省略**，不写「- 核心词汇：」这种有标签没内容的行——
 * 那等于给模型一个占位，与「缺失留空、不写占位」的要求冲突。
 */
export function outlineSourceText(lesson: OutlineSourceLesson): string {
  const field = (label: string, value: string | null | undefined): string => {
    const trimmed = value?.trim();
    return trimmed ? `- ${label}：${trimmed}` : "";
  };
  return [
    `# Lesson ${lesson.lessonNumber} ${lesson.title}`,
    field("主题", lesson.theme),
    field("核心词汇", lesson.coreVocabulary),
    field("阅读", lesson.reading),
    field("语法", lesson.grammar),
    field("考试技能", lesson.examSkills),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 模块取不到来源时，给一句能指向原因的话。
 *
 * 旧版**并不是每一课都有全部栏目**：实测学生用书旧版单元 2、4 用 `Hello Listening`
 * 代替 `Hello Reading`，部门大纲这两课的「考试技能」也只有 Listening / Speaking / Writing。
 * 所以这一课的 `Let's read!` 本来就无处可取。把它说成事实，别让老师以为软件坏了；
 * 同时提示另一种可能（OCR 漏了栏目标题），因为两种情况的表现一模一样。
 */
export function missingSourceMessage(input: {
  moduleLabel: string;
  /** 旧版对应讲次；null 表示没解析出讲次。 */
  sourceLessonNumber: number | null;
  /** 该讲次的来源块统计（`lessonSourceStats`）。 */
  stats: LessonSourceStats;
}): string {
  const lesson = input.sourceLessonNumber ? `旧版第 ${input.sourceLessonNumber} 讲` : "旧版对应讲次";
  if (input.stats.usable > 0) {
    return (
      `${lesson}里没有「${input.moduleLabel}」对应的栏目：` +
      "这一课旧版可能本来就没有该栏目，也可能是 OCR 漏了栏目标题，请对照原书确认"
    );
  }
  // 栏目都在、但都只作来源：旧版有这些栏目，新版没有对应位置。
  if (input.stats.sourceOnly > 0) {
    return `${lesson}的栏目都只作来源（旧版有、新版没有对应位置），本模块没有可生成的内容`;
  }
  // 有正文却没有栏目：结构对不上，例如整课复习用 `## ① …` 编号而没有栏目标题。
  if (input.stats.hasText) {
    return (
      `${lesson}有正文，但没有识别到可对应的栏目：` +
      "这一讲的栏目结构与本模块对不上，请对照原书核对（新版该课的板块结构也可能还没确认）"
    );
  }
  return `${lesson}没有可生成的内容`;
}

export function selectSourceText(input: SourceSelectionInput): string | null {
  const sections = input.module?.sourceSections ?? [];

  // 1. 确定性模块（两个书种的课时目标）。
  //
  //    学生用书的课时目标优先取旧版 `I can` / `In this lesson, I can` 清单：
  //    那是旧书里已经确认过的能力描述，属于**精准迁移**；部门大纲的主题列常是
  //    中文说明，只能当参考，不能直接写进英文目标页（需求方 2026-10-28 指正）。
  //    知识清单的学习目标是「字段 + 内容」表，内容本来就来自大纲，继续用大纲。
  if (input.module?.deterministic && input.outlineLesson) {
    if (input.module.deterministic === "objectives_lesson_page") {
      const objectives = input.candidates
        .filter((candidate) => candidate.sectionKey === "objectives")
        .map((candidate) => candidate.rawText)
        .filter(Boolean);
      if (objectives.length > 0) return objectives.join(String.fromCharCode(10, 10));
    }
    return outlineSourceText(input.outlineLesson);
  }

  // 2. 按目录声明的栏目取旧版材料。
  //    一个模块可以对应多个栏目（学生用书的 say 含 Hello Vocabulary 与
  //    Develop Your Vocabulary），按栏目顺序全部取走，不能只取第一块。
  if (sections.length > 0) {
    const texts = sections.flatMap((section) =>
      input.candidates
        .filter((candidate) => candidate.sectionKey === section)
        .map((candidate) => candidate.rawText)
        .filter(Boolean),
    );
    if (texts.length > 0) return texts.join("\n\n");
  }

  // 3. 没导入过旧版材料时，退回整份原文；导入过但没有对应栏目则返回 null，
  //    由调用方用 missingSourceMessage 给出能指向原因的提示。
  return input.hasLegacyPackages ? null : input.rawSourceText.trim() || null;
}
