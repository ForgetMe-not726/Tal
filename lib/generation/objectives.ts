/**
 * 课时目标的**确定性生成器**——不走模型，直接由大纲算出正文。
 *
 * 目标字段（主题、核心词汇、核心语法、阅读文章、技能训练）都来自部门大纲的 Lesson Profile，
 * 是已经人工确认的事实。交给模型改写只会引入串位和编造，所以用代码拼。
 *
 * 两个书种的呈现形态不同，由目录里的 `deterministic` 字段选择：
 * - 知识清单 → 四行「字段名 + 内容」表（`objectives_table`）
 * - 学生用书 → 主题页 `In this lesson, we will...`（`objectives_lesson_page`）
 *
 * 骨架与字段名见 `lib/modules/directory.ts`；换模板时改这里或改为从模板数据读取。
 */

import type { DeterministicBuilder } from "@/lib/modules/directory";

type ObjectivesProfile = {
  coreVocabulary: string | null;
  grammar: string | null;
  reading: string | null;
  /** 大纲原文（可能多个题型）。 */
  examSkills: string | null;
  /** 实际使用的一个题型；没给就退回 `examSkills`。 */
  primaryExamSkill?: string | null;
  theme?: string | null;
};

/** 大纲单元格是自由文本，取值时清掉数量标注、统一换行和空格。 */
function cellValue(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/核心词汇数量[:：]\s*\d+\s*个/gu, "")
    .replace(/阅读字数统计[:：]\s*\d+/gu, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("；");
}

/**
 * 知识清单：学习目标表。
 * 无信息时留空，不写占位文字（R-SB-005 / R-KL 一致的要求）。
 */
export function buildObjectivesMarkdown(profile: ObjectivesProfile): string | null {
  const rows: Array<[string, string]> = [
    ["目标词汇", cellValue(profile.coreVocabulary)],
    ["核心语法", cellValue(profile.grammar)],
    ["阅读文章", cellValue(profile.reading)],
    ["技能训练", cellValue(profile.primaryExamSkill ?? profile.examSkills)],
  ];
  if (!rows.some(([, value]) => value)) return null;
  const body = rows.map(([label, value]) => `| ${label} | ${value} |`).join("\n");
  return `## 学习目标\n\n| | |\n| --- | --- |\n${body}`;
}

/**
 * 复习课主题页的三条目标。
 *
 * 与常规课不同，复习课的目标**不取大纲字段**——它是固定句式，说的是"复习前几课的
 * 词汇与语法"，与具体内容无关。依据是成稿样本（Lesson 15「Fun with review」）：
 *
 * ```text
 * - review the words from the previous lessons.
 * - review the grammar from the previous lessons.
 * - understand and practise the skills from the exam.
 * ```
 *
 * 这一点在寒假册上尤其重要：部门大纲的 Lesson 7 整行为空，若照常规课那样从字段拼，
 * 会拼出空串、复习课直接生成不了。
 */
const REVISION_OBJECTIVES: readonly string[] = [
  "review the words from the previous lessons.",
  "review the grammar from the previous lessons.",
  "understand and practise the skills from the exam.",
];

/**
 * 学生用书：主题页 `In this lesson, we will...`。
 *
 * 常规课四条（主题词汇 / 阅读文章 / 核心语法 / 考试技能训练），复习课三条——复习课不含
 * 阅读，所以省掉阅读那一条（见 `迁移对应关系-学生用书-初拟.md` §1.1）。
 * 常规课某条的大纲字段为空时**整条省略**，不留空行、不写占位。
 *
 * 句式照成稿（Lesson 13）：`learn words about …` / `read the article …`（文章名不加引号）/
 * `learn the grammar of …` / `practise the use of …`。
 */
export function buildLessonObjectivesMarkdown(
  profile: ObjectivesProfile,
  options: { revision?: boolean } = {},
): string | null {
  const lines = options.revision
    ? [...REVISION_OBJECTIVES]
    : [
        cellValue(profile.theme) ? `learn words about ${cellValue(profile.theme)}` : "",
        cellValue(profile.reading) ? `read the article ${cellValue(profile.reading)}` : "",
        cellValue(profile.grammar) ? `learn the grammar of ${cellValue(profile.grammar)}` : "",
        cellValue(profile.primaryExamSkill ?? profile.examSkills)
          ? `practise the use of ${cellValue(profile.primaryExamSkill ?? profile.examSkills)}`
          : "",
      ].filter(Boolean);

  if (lines.length === 0) return null;
  const body = lines.map((line) => `- ${line}`).join("\n");
  return `## In this lesson, we will...\n\n${body}`;
}

/** 按目录里的 `deterministic` 选择生成器。 */
export function buildDeterministicObjectives(
  builder: DeterministicBuilder,
  profile: ObjectivesProfile,
  options: { revision?: boolean } = {},
): string | null {
  return builder === "objectives_lesson_page"
    ? buildLessonObjectivesMarkdown(profile, options)
    : buildObjectivesMarkdown(profile);
}
