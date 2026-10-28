/**
 * 课时目标的**确定性生成器**——不走模型，直接用已确认的事实拼正文。
 *
 * 两个书种的事实来源不同：
 * - 知识清单 → 大纲的四行字段（目标词汇 / 核心语法 / 阅读文章 / 技能训练）；
 * - 学生用书 → **旧版 `I can` / `In this lesson, I can` 清单**（精准迁移）。
 *   大纲的主题列常是中文说明，只能当参考；拿它拼英文目标页会把中文搬进教材
 *   （2026-10-28 需求方指正）。没有旧版清单时才退回大纲字段，并跳过含中文的项。
 *
 * 两个书种的呈现形态由目录里的 `deterministic` 字段选择：
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

const CJK = /[\u3400-\u9fff]/u;
/** 目标页是英文正文：含中文的字段一律不用，宁可少一行也不把中文搬进教材。 */
function hasCjk(value: string): boolean {
  return CJK.test(value);
}

/**
 * 从旧版 `I can` 栏目里抽出能力清单。
 *
 * OCR 的写法不统一：`-- use words …`、`- read …`、一行里两条用 ` - ` 隔开，
 * 清单后面还可能接着别的内容。这里只取清单本身，去掉标题、注释和项目符号。
 */
export function extractIcanStatements(sourceText: string | null | undefined): string[] {
  if (!sourceText) return [];
  const lines = sourceText
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split(String.fromCharCode(10))
    .filter((line) => !/^\s*#{1,6}\s/u.test(line))
    .map((line) => line.trim())
    .filter(Boolean);

  const statements: string[] = [];
  const bullet = /^(?:[-–—•*]+|\d+[.)]|[①-⑳])\s*/u;
  for (const line of lines) {
    const pieces = line.split(/\s+[-–—]\s+/u);
    for (const [index, piece] of pieces.entries()) {
      const content = piece.replace(bullet, "").replace(/^--+\s*/u, "").trim();
      if (!content) continue;
      if (index > 0 || bullet.test(piece)) {
        statements.push(content);
      } else if (statements.length === 0) {
        statements.push(content);
      } else {
        statements[statements.length - 1] += ` ${content}`;
      }
    }
  }
  // 2.0 版 OCR 会把动词和后面的词粘在一起（usewords / usethe）。
  // 只在明确的常用词前补空格，不碰其他文本——避免把 user / reading 拆坏。
  const glued = /\b(use|read|listen|write|talk|learn|practise|discuss)(?=(?:words?|the|a|an|about|to|with)\b)/giu;
  return statements
    .map((item) => item.replace(/^I can\s+/iu, "").replace(glued, "$1 ").trim())
    .filter((item) => item && !hasCjk(item));
}

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
  options: { revision?: boolean; sourceText?: string | null } = {},
): string | null {
  // 旧版 I can 清单是已经人工确认的能力描述，优先逐条迁移
  const fromSource = options.revision ? [] : extractIcanStatements(options.sourceText);
  const english = (value: string | null | undefined): string => {
    const text = cellValue(value);
    return text && !hasCjk(text) ? text : "";
  };
  const lines = options.revision
    ? [...REVISION_OBJECTIVES]
    : fromSource.length > 0
      ? fromSource
      : [
          english(profile.theme) ? `learn words about ${english(profile.theme)}` : "",
          english(profile.reading) ? `read the article ${english(profile.reading)}` : "",
          english(profile.grammar) ? `learn the grammar of ${english(profile.grammar)}` : "",
          english(profile.primaryExamSkill ?? profile.examSkills)
            ? `practise the use of ${english(profile.primaryExamSkill ?? profile.examSkills)}`
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
  options: { revision?: boolean; sourceText?: string | null } = {},
): string | null {
  return builder === "objectives_lesson_page"
    ? buildLessonObjectivesMarkdown(profile, options)
    : buildObjectivesMarkdown(profile);
}
