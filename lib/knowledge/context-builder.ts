// 相对路径（不是 `@/`）：本模块只有这一个运行时 import，用相对路径才能被 node 直接
// 单测——这个函数是「HTML 表格不进 prompt」的最后一道闸，必须能被测试盯住。
import { htmlTablesToMarkdown } from "../markdown/html-tables.ts";
import type { EffectiveRuleSet } from "@/lib/rules/resolve-core";
import type { KnowledgeContext, RetrievedKnowledge, RetrievalTrace } from "@/lib/knowledge/types";

export type ContextBuildInput = {
  entries: RetrievedKnowledge[];
  trace: RetrievalTrace;
  ruleSet?: EffectiveRuleSet;
  relatedContent?: Array<{ label: string; markdown: string }>;
  lessonContext?: Record<string, unknown> | null;
};

function sourceLine(item: RetrievedKnowledge) {
  const source = item.entry.source_ref || "unknown-source";
  const page = item.sourceModule?.page == null ? "" : ` · p.${item.sourceModule.page}`;
  return `[${item.entry.layer} · ${item.reason} · ${source}${page}]`;
}

export function buildKnowledgeContext(input: ContextBuildInput): KnowledgeContext {
  // 来源正文里可能残留旧版 OCR 的 HTML 表格：修复前保存进工作区的条目就是带 HTML 的，
  // 重新生成时会照旧被检索出来。所以在**进 prompt 前**再过一道，不只依赖解析时转换。
  const sourceText = input.entries
    .map((item) => `### ${item.entry.title} ${sourceLine(item)}\n${htmlTablesToMarkdown(item.entry.content)}`)
    .join("\n\n");
  return {
    sourceText,
    sourceRefs: input.entries.map((item) => item.entry.source_ref),
    trace: input.trace,
    entries: input.entries,
  };
}

export function renderContextForPrompt(input: ContextBuildInput): string {
  const context = buildKnowledgeContext(input);
  const rules = input.ruleSet?.allRules
    .map(
      (item) =>
        `### ${item.rule.rule_key} · v${item.version.version_number} · ${item.binding.scope}${item.rule.is_hard ? " · HARD" : ""}\n${item.version.instruction}\n约束:${JSON.stringify(item.version.constraints)}`,
    )
    .join("\n\n");
  const related = (input.relatedContent ?? [])
    .filter((item) => item.markdown.trim())
    .map((item) => `### ${item.label}\n${item.markdown}`)
    .join("\n\n");

  return [
    "【已确认结构化来源】",
    context.sourceText || "（没有可用的已确认 Production Source。）",
    "【规则快照】",
    rules || "（无）",
    "【已确认关联内容】",
    related || "（无）",
    "【Lesson Context】",
    input.lessonContext ? JSON.stringify(input.lessonContext) : "（无）",
    "【检索审计摘要】",
    JSON.stringify(context.trace),
  ].join("\n\n");
}
