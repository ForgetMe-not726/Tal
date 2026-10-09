/**
 * 迁移**覆盖检查**：大纲要求的核心内容有没有真的进到正文里。
 *
 * 为什么需要：实测知识清单 Lesson 1 生成时，大纲列的 15 个核心词只出了 13 个——
 * `densely populated` 与 `first-rate` 被模型漏掉了，而**源里这两个词是完整的**。
 * 这类丢失没有任何检查会发现：规则检查器只看词数、禁用词、必需章节，
 * 不知道"大纲要求的词是否都在正文里"。
 *
 * 这是**结构性检查**而不是规则检查：数据来自大纲的 Lesson Profile（每课不同），
 * 不是教研配置的规则。所以单独成模块，用 `builtin:` 前缀的标识与规则检查区分，
 * 但复用同一套 issue 结构，界面与版本 metadata 都能直接展示。
 */

import type { RuleCheckIssue } from "@/lib/rules/checks";

/** 内置检查的标识前缀，与规则检查（`R-XX-NNN`）区分开。 */
export const BUILTIN_PREFIX = "builtin:";

export type CoverageIssue = RuleCheckIssue;

/**
 * 比对前统一空白。
 *
 * 为什么必须做：实测大纲单元格里的 `densely populated` 用的是**不间断空格**
 * （U+00A0），而正文里是普通空格——直接 `includes` 会把它判成"漏词"，
 * 报出根本没丢的词。反过来正文里也可能出现多余空格，同样要归一。
 */
function normalizeSpaces(value: string): string {
  // `\s` 覆盖 U+00A0 与全角空格；连空白一起压成单个普通空格。
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

/**
 * 把大纲的单元格值拆成词条。
 *
 * 大纲的写法是「核心词汇数量：15个\ncharm, inhabitant, ...」这类自由文本，
 * 要先清掉数量标注再按分隔符拆。
 */
export function parseVocabularyList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/核心词汇数量[:：]\s*\d+\s*个/gu, "")
    .replace(/阅读字数统计[:：]\s*\d+/gu, "")
    .split(/[,，、;；\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 找出大纲要求、但正文里找不到的词条。
 *
 * 判据是「正文里出现过这个词」——出现即可，不要求它在词卡表里。
 * 这是有意的放宽：不同书种的承载形式不同（知识清单是词卡表，学生用书是加粗短文），
 * 强行要求某种形状会误报。代价是「词只出现在别的例句里」这种情况查不出来，
 * 但那属于更细的保真问题，不是"整条丢失"。
 */
export function findMissingVocabulary(
  markdown: string,
  vocabulary: readonly string[],
): string[] {
  const haystack = normalizeSpaces(markdown);
  return vocabulary.filter((word) => {
    const needle = normalizeSpaces(word);
    return needle.length > 0 && !haystack.includes(needle);
  });
}

/**
 * 核心词汇覆盖检查。
 *
 * 返回空数组表示大纲要求的词都在正文里出现过了。
 */
export function checkVocabularyCoverage(
  markdown: string,
  coreVocabulary: string | null | undefined,
): CoverageIssue[] {
  const wanted = parseVocabularyList(coreVocabulary);
  if (wanted.length === 0) return [];
  const missing = findMissingVocabulary(markdown, wanted);
  if (missing.length === 0) return [];
  return [
    {
      ruleKey: `${BUILTIN_PREFIX}core_vocabulary`,
      versionNumber: 0,
      code: "required_sections",
      message:
        `大纲列出的 ${wanted.length} 个核心词汇里有 ${missing.length} 个没有出现在正文中：` +
        `${missing.join("、")}。请补上这些词条，不要遗漏。`,
      expected: wanted,
      actual: wanted.filter((word) => !missing.includes(word)),
      evidence: missing.join("、"),
    },
  ];
}
