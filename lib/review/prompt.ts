/**
 * 审校 Prompt 的构造。**纯函数**，与网关调用分开——老师要能问"你到底让模型查了什么"，
 * 而这段内容也应当能被单测与审计直接读。
 */

import type { EffectiveRule } from "../rules/resolve-core.ts";

/** 规则清单文本：保留 ID、硬度、版本与约束，便于模型按 ID 回报。 */
export function renderRules(rules: readonly EffectiveRule[]): string {
  return rules
    .map(
      (item) =>
        `- ${item.rule.rule_key}（v${item.version.version_number}${item.rule.is_hard ? "，红线" : ""}）：${item.version.instruction}\n  机器约束：${JSON.stringify(item.version.constraints)}`,
    )
    .join("\n");
}

export type LlmReviewInput = {
  bookType: string;
  moduleKey: string;
  moduleLabel: string;
  lessonNumber: number;
  lessonTitle: string;
  markdown: string;
  rules: readonly EffectiveRule[];
  /**
   * 本次用到的判据小节（按规则的 `standard_refs` 取用）。
   *
   * 审校标准要求"软件不能只读规则目录就跳过对应标准章节"——所以判据要进 Prompt；
   * 但也**只带被引用到的那些小节**，不整本塞（四份材料共 140 KB）。
   */
  standards?: string;
  /** 大纲该课的目标（主题/词汇/语法/阅读/技能），让模型能判断"是否超纲、是否覆盖"。 */
  outline: {
    theme?: string | null;
    coreVocabulary?: string | null;
    grammar?: string | null;
    reading?: string | null;
    examSkills?: string | null;
  } | null;
};

/** Prompt 是纯函数，便于单测与审计（老师能问"你到底让模型查了什么"）。 */
export function buildReviewPrompt(input: LlmReviewInput): string {
  const outline = input.outline
    ? [
        input.outline.theme ? `主题：${input.outline.theme}` : "",
        input.outline.coreVocabulary ? `核心词汇：${input.outline.coreVocabulary}` : "",
        input.outline.grammar ? `核心语法：${input.outline.grammar}` : "",
        input.outline.reading ? `阅读文章：${input.outline.reading}` : "",
        input.outline.examSkills ? `考试技能：${input.outline.examSkills}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "（未提供大纲）";

  return `请按下面列出的规则审校这一份教材模块，逐条给出可定位的问题。

【模块】${input.bookType}/${input.moduleKey}（${input.moduleLabel}）· Lesson ${input.lessonNumber} ${input.lessonTitle}

【本课大纲（判断是否超纲、是否覆盖的依据）】
${outline}

【审校规则（只查这些，不要发明新规则）】
${renderRules(input.rules) || "（本次没有生效规则）"}
${
  input.standards?.trim()
    ? `
【本次规则引用的判据（判断依据，来自公司审校标准）】
${input.standards}`
    : ""
}

【待审正文】
${input.markdown}

要求：
1. 每条问题必须给出 rule_key（必须是上面列出的 ID 之一）、verdict、original_text（正文里**原样出现**的片段，用于定位）、message（问题是什么）、suggestion（怎么改，给不出就留空）、evidence（判断依据：规则原文或大纲事实）、confidence（0–1）。
2. verdict 只能取两个值：
   - "needs_revision"：确实有问题，且你按规则判定应当修改；
   - "cannot_verify"：**材料没提供、无法核查**（如需要剑桥官方词表或正式答案表而上面没给）。
     这时在 message 里写明缺什么资料，不要编造结论。
3. **找不到正文依据就不要报**。判据里没给的规则，不要凭常识替代。
4. 不要重述规则、不要输出与正文无关的通评、不要给整篇改写。
5. 只输出 JSON：{"findings":[{"rule_key":"","verdict":"needs_revision","original_text":"","message":"","suggestion":"","evidence":"","confidence":0.0}]}`;
}
