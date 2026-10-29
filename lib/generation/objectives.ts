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
  /** 大纲的阅读题型；考试技能列为空时作为第四条目标。 */
  readingExamType?: string | null;
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
 * 格式照秋下成稿**固定四条**（复习课三条），句式固定：
 * - learn words about <主题词汇>
 * - read the article <文章标题>
 * - learn the grammar of <语法点>
 * - practise the use of <题型>（或旧版技能句 / 旧版 I can 的剩余技能）
 *
 * 取值来源：旧版 I can 提供英文主题与技能句；大纲提供阅读标题、语法英文名和题型。
 * 大纲里的中文说明只作参考，绝不原样写入英文正文。
 */
function stripEnd(value: string): string {
  return value.trim().replace(/[。.]+$/u, "").trim();
}

function withPeriod(value: string): string {
  const text = stripEnd(value);
  if (!text) return "";
  return /[?!]$/u.test(text) ? text : `${text}.`;
}

const GRAMMAR_WORDS =
  /grammar|tense|clause|conditional|verb|noun|adjective|adverb|pronoun|preposition|conjunction|passive|modal|voice|form|collocation/iu;

/** 大纲的语法列常是「中文名（English name；细节）」：只取英文部分。 */
function englishGrammar(value: string | null | undefined): string {
  const text = cellValue(value);
  if (!text) return "";
  const segments = text.split(/[：:]/u).map((part) => part.trim()).filter(Boolean);
  const before = segments[0];
  if (before && !hasCjk(before) && /[A-Za-z]/u.test(before)) return before;
  const after = segments
    .slice(1)
    .filter((part) => /[A-Za-z]/u.test(part) && !hasCjk(part))
    .sort((a, b) => b.length - a.length)[0];
  if (after) return after;
  const parenthesized = [...text.matchAll(/[（(]([^（）()]*[A-Za-z][^（）()]*)[）)]/gu)]
    .map((match) => match[1]!.trim())
    .filter((part) => part && !hasCjk(part))
    .sort((a, b) => b.length - a.length)[0];
  if (parenthesized) return parenthesized.replace(/；/gu, "; ");
  return hasCjk(text) ? "" : text;
}

/** 阅读列常写成「主题 > 文章」或「文章（中文说明）」：取主文章标题。 */
function readingTitle(value: string | null | undefined): string {
  const firstLine = (value ?? "")
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? "";
  const withoutCount = firstLine.replace(/阅读字数统计[:：]\s*\d+/gu, "").trim();
  // 「Goodnight and sleep tight（1.0 春 Lesson 7 原文…）」：括号里是中文说明，不是标题
  const title = withoutCount.split(/[（(]/u)[0].split(">").pop()?.trim() ?? "";
  return title && !hasCjk(title) ? title : "";
}

function vocabularyTopic(statements: string[], theme: string | null | undefined): string {
  for (const statement of statements) {
    const match = /use (?:words|vocabulary|verbs|phrases) (?:related to|about) (.+)$/iu.exec(statement);
    if (match?.[1]) return stripEnd(match[1]);
  }
  const text = cellValue(theme);
  return text && !hasCjk(text) ? stripEnd(text) : "";
}

function grammarFromStatements(statements: string[]): string {
  const statement = statements.find((item) => GRAMMAR_WORDS.test(item));
  if (!statement) return "";
  const match = /^(?:use|revise|learn) (.+)$/iu.exec(statement);
  return match?.[1] ? stripEnd(match[1]) : "";
}

function pickSkillStatement(statements: string[], used: Set<string>): string {
  const candidates = statements.filter((item) => !used.has(item));
  return (
    candidates.find((item) => /^(listen|write|speak|discuss|talk)\b/iu.test(item)) ??
    candidates.find((item) => !GRAMMAR_WORDS.test(item)) ??
    ""
  );
}

export function buildLessonObjectivesMarkdown(
  profile: ObjectivesProfile,
  options: { revision?: boolean; sourceText?: string | null } = {},
): string | null {
  if (options.revision) {
    return `## In this lesson, we will...\n\n${REVISION_OBJECTIVES.map((line) => `- ${line}`).join("\n")}`;
  }

  const statements = extractIcanStatements(options.sourceText);
  const used = new Set<string>();

  const vocab = vocabularyTopic(statements, profile.theme);
  const vocabStatement = statements.find((item) =>
    /use (?:words|vocabulary|verbs|phrases) (?:related to|about) /iu.test(item),
  );
  if (vocabStatement) used.add(vocabStatement);

  const grammarStatements = statements.filter((item) => GRAMMAR_WORDS.test(item));
  const grammar = englishGrammar(profile.grammar) || grammarFromStatements(statements);
  const grammarStatement = grammarStatements.find((item) => item.includes(grammar));
  if (grammarStatement) used.add(grammarStatement);

  const reading = readingTitle(profile.reading);
  const placeholder = /^(?:待定|待确认|暂无|TBD|TODO)$/iu;
  const clean = (value: string): string => (placeholder.test(value) ? "" : value);
  const exam = clean(stripEnd(profile.primaryExamSkill ?? profile.examSkills ?? ""));
  const examType = clean(stripEnd(profile.readingExamType ?? ""));
  const skill = exam
    ? `practise the use of ${exam}`
    : examType
      ? `practise the use of ${examType}`
      : stripEnd(pickSkillStatement(statements, used));

  const lines = [
    vocab ? `learn words about ${vocab}` : "",
    reading ? `read the article ${reading}` : "",
    grammar ? `learn the grammar of ${grammar}` : "",
    skill,
  ]
    .filter(Boolean)
    .map(withPeriod);

  if (lines.length === 0) return null;
  return `## In this lesson, we will...\n\n${lines.map((line) => `- ${line}`).join("\n")}`;
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
