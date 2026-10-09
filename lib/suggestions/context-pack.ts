/**
 * 修改建议的 **Context Pack** 契约（`docs/AI-ASSISTANT-RETRIEVAL.md` §2、`profile.md` §7.2）。
 *
 * 七部分：老师的要求 / 当前模块版本 / Lesson Context / 生效规则 / 跨书上下文 /
 * 本地参考资料 / 资料缺口。
 *
 * 两条设计纪律：
 * 1. **规则是参考知识库，不是逐条硬性对照**（2026-10-09 确认）。老师这次的要求是任务目标，
 *    模型据此判断；规则用于支撑判断与提示红线。冲突时**如实指出**，不生硬照搬也不默默违背。
 *    保存时生成侧 Hard Rule 仍由确定性检查拦截——那是机器门禁，与模型判断分开。
 * 2. **资料缺口如实列出**。没有剑桥资料就写"没有"，不假装检索过；
 *    依据不全时让模型知道它手上的证据是残缺的，比给它一个漂亮但空的前提有用。
 *
 * 本文件只有**类型与纯函数**（import 全是 type-only），所以能被 node 直接单测；
 * 组装那部分要读工作区，在 `pack-source.ts` 里。
 */

import type { BookType, KnowledgeLayer, RuleScope } from "@/lib/db/types";

export type PackRule = {
  ruleKey: string;
  displayName: string;
  scope: RuleScope;
  isHard: boolean;
  versionNumber: number;
  specificity: number;
  instruction: string;
  constraints: Record<string, unknown>;
};

export type PackEvidence = {
  label: string;
  sourceRef: string;
  layer: KnowledgeLayer;
  page: number | null;
  /** 能定位到已确认的 OCR 来源时带上，供「查看原页」。 */
  ocrJobId: string | null;
  excerpt: string;
};

export type PackGap = {
  /** 机器可读的分类，便于界面归组。 */
  kind:
    | "no_reference_material"
    | "no_lesson_context"
    | "no_rules"
    | "budget"
    | "truncated"
    | "no_related_content";
  message: string;
};

export type SuggestionContextPack = {
  teacherRequest: string;
  module: {
    bookType: BookType;
    moduleKey: string;
    moduleLabel: string;
    lessonNumber: number | null;
    lessonTitle: string | null;
    versionId: string | null;
    versionNumber: number | null;
    markdown: string;
  };
  lessonContext: Record<string, unknown> | null;
  rules: {
    entries: PackRule[];
    conflicts: Array<{ key: string; summary: string }>;
  };
  related: Array<{ label: string; markdown: string }>;
  evidence: PackEvidence[];
  gaps: PackGap[];
};

/** 正文超预算时按前缀截断（并让调用方记一条缺口）。 */
export function truncateForBudget(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/** 把版本 metadata 里的 `lesson_profile` 取成 Lesson Context（没有就返回 null，不猜）。 */
export function lessonContextFrom(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const profile = (metadata as { lesson_profile?: unknown }).lesson_profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  const entries = Object.entries(profile as Record<string, unknown>).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/** 一条规则在 Prompt 里的写法：ID、作用域、硬度、版本、指令、约束都留着。 */
function renderRule(rule: PackRule): string {
  const tags = [rule.scope, rule.isHard ? "红线" : "普通", `v${rule.versionNumber}`].join(" · ");
  const constraints =
    Object.keys(rule.constraints).length > 0 ? `\n  约束：${JSON.stringify(rule.constraints)}` : "";
  return `- ${rule.ruleKey}（${rule.displayName}）${tags}\n  ${rule.instruction}${constraints}`;
}

/**
 * 渲染成 Prompt 文本。**纯函数**：老师要能问"你到底让模型看了什么"，
 * 这段内容也应当能被单测与审计直接读。
 */
export function renderSuggestionPrompt(pack: SuggestionContextPack): string {
  const context = pack.lessonContext
    ? Object.entries(pack.lessonContext)
        .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join("\n")
    : "（本次没有大纲信息）";

  const rules =
    pack.rules.entries.length > 0
      ? pack.rules.entries.map(renderRule).join("\n")
      : "（本次没有生效规则）";
  const conflicts =
    pack.rules.conflicts.length > 0
      ? pack.rules.conflicts.map((item) => `- ${item.summary}`).join("\n")
      : "（本次没有发现约束冲突）";
  const related =
    pack.related.length > 0
      ? pack.related.map((item) => `### ${item.label}\n${item.markdown}`).join("\n\n")
      : "（无）";
  const evidence =
    pack.evidence.length > 0
      ? pack.evidence
          .map(
            (item) =>
              `### ${item.label} [${item.layer} · ${item.sourceRef}${item.page == null ? "" : ` · p.${item.page}`}]\n${item.excerpt}`,
          )
          .join("\n\n")
      : "（本地没有已确认的参考资料）";
  const gaps = pack.gaps.length > 0 ? pack.gaps.map((gap) => `- ${gap.message}`).join("\n") : "（无）";

  return `请根据老师的要求修改下面这一份教材模块，逐条给出可采用的修改建议。

【老师的要求（本次任务目标）】
${pack.teacherRequest}

【当前模块】
${pack.module.bookType}/${pack.module.moduleKey}（${pack.module.moduleLabel}）${
    pack.module.lessonNumber == null ? "" : ` · Lesson ${pack.module.lessonNumber} ${pack.module.lessonTitle ?? ""}`
  }${pack.module.versionNumber == null ? "" : ` · 基于 v${pack.module.versionNumber}`}

【本课目标（大纲，判断是否超纲与是否覆盖的依据）】
${context}

【规则参考知识库（供你判断与提示，不要求逐条机械对照）】
${rules}

【规则冲突（同一约束被不同规则设成了不同的值）】
${conflicts}

【同一 Lesson 的其他已确认内容】
${related}

【本地参考资料（带来源定位）】
${evidence}

【资料缺口（本次依据不全，判断时请据此保留余地）】
${gaps}

【待修改正文】
${pack.module.markdown}

要求：
1. 老师的要求是本次任务目标。规则是判断依据：用它支撑你的改动与理由，**不要逐条机械对照**；
   老师的要求与某条规则冲突、或规则之间互相冲突时，在 reason 或 uncertainty 里说明你的判断和取舍理由，
   不要默默违背，也不要生硬拒绝。
2. 每条建议给出 kind（replace/insert/delete/note）、original_text（正文里**原样出现**的片段）、
   replacement_text（怎么改）、reason（为什么这么改）、rule_ids（依据的规则 ID，必须是上面列出的）、
   evidence（依据的来源，必须是上面列出的 source_ref）、uncertainty（哪里没把握、缺什么资料）。
3. **找不到正文依据就不要报**；资料不足时在 uncertainty 里说明缺什么，不要用模型常识冒充规则或参考资料。
4. 不要重述规则、不要输出与正文无关的通评、不要给整篇改写。
5. 只输出 JSON：{"suggestions":[{"kind":"replace","original_text":"","replacement_text":"","reason":"","rule_ids":[],"evidence":[],"uncertainty":""}]}`;
}
