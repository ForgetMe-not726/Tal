/**
 * Context Pack 的**组装**：读工作区，把七部分凑齐。
 *
 * 与 `context-pack.ts` 分开是为了让契约与渲染那部分能被 node 直接单测——
 * 这里要读工作区（`@/` 别名 + 文件系统），只能靠集成跑。
 *
 * 每一步取不到东西都**记进 gaps**，不静默省略：模型看到缺口才知道自己的判断余地有多大。
 */

import type { BookType, Grade } from "@/lib/db/types";
import { getAppStore } from "@/lib/db/store";
import { loadGrammarReference } from "@/lib/knowledge/grammar-reference";
import { loadRelatedVersions } from "@/lib/knowledge/related-content";
import { listConfirmedSources } from "@/lib/ocr/jobs";
import { constraintConflicts, describeConflict } from "@/lib/rules/conflicts";
import { resolveEffectiveRules } from "@/lib/rules/resolver";
import type { EffectiveRule } from "@/lib/rules/resolve-core";
import {
  lessonContextFrom,
  truncateForBudget,
  type PackEvidence,
  type PackGap,
  type PackRule,
  type SuggestionContextPack,
} from "./context-pack.ts";

/** 正文预算：单模块正文一般远小于此，超了按前缀截断并如实记录。 */
const MAX_CONTENT_CHARS = 24000;
/** 跨书上下文预算。 */
const MAX_RELATED_CHARS = 12000;
/** 参考资料最多带几条。 */
const MAX_EVIDENCE_ENTRIES = 8;
/** 参考资料正文片段长度。 */
const EVIDENCE_EXCERPT_CHARS = 600;
/**
 * 本课语法参考进 Prompt 的预算。
 *
 * 取前段就够支撑判断：修改建议的 Prompt 里已经有规则库、跨书上下文和正文，
 * 把整个语法点（8–20 KB）塞进去会挤掉真正要用的东西。完整内容在知识库里，按来源可查。
 */
const MAX_GRAMMAR_CHARS = 5000;

export type SuggestionPackInput = {
  projectId?: string;
  lessonId?: string;
  lessonNumber?: number;
  lessonTitle?: string;
  grade: Grade;
  bookType: BookType;
  moduleKey: string;
  moduleLabel?: string;
  /** 老师正在改的草稿正文（不是已保存的版本正文）。 */
  content: string;
  instruction: string;
  /** 草稿所基于的版本；有它才能取 Lesson Context 与来源证据。 */
  versionId?: string;
};

function ruleToPackRule(item: EffectiveRule): PackRule {
  return {
    ruleKey: item.rule.rule_key,
    displayName: item.rule.display_name,
    scope: item.binding.scope,
    isHard: item.rule.is_hard,
    versionNumber: item.version.version_number,
    specificity: item.specificity,
    instruction: item.version.instruction,
    constraints: item.version.constraints ?? {},
  };
}

/** 取本地已确认的参考资料，并尽量挂上 OCR 来源以便「查看原页」。 */
async function loadEvidence(input: SuggestionPackInput): Promise<PackEvidence[]> {
  const store = getAppStore();
  // 只取权威标准与参考材料两层：旧版教材是 production_source，不算"参考资料"。
  // 不传 projectId/lessonId——参考资料是工作区级共享的（剑桥资料不属于某一课）。
  const rows = await store.listKnowledgeEntries({
    layers: ["authoritative_standards", "reference_materials"],
    confirmedOnly: true,
  });
  if (rows.length === 0) return [];

  // 旧版文件名 → 已确认的 OCR 任务，供页图定位；取不到就只显示文字定位。
  const jobByDocument = new Map<string, string>();
  if (input.projectId) {
    for (const source of await listConfirmedSources({ projectId: input.projectId })) {
      if (!jobByDocument.has(source.originalName)) jobByDocument.set(source.originalName, source.jobId);
    }
  }

  return rows.slice(0, MAX_EVIDENCE_ENTRIES).map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const document = typeof payload.source_document === "string" ? payload.source_document : "";
    const page = typeof payload.page === "number" ? payload.page : null;
    return {
      label: row.title,
      sourceRef: row.source_ref,
      layer: row.layer,
      page,
      ocrJobId: document ? jobByDocument.get(document) ?? null : null,
      excerpt: row.content.slice(0, EVIDENCE_EXCERPT_CHARS),
    };
  });
}

/**
 * 本课语法点的参考（`resources/knowledge/grammar/`，随包基线）。
 *
 * 这是修改建议最直接的外部依据：老师说"把难度调低"时，依据应当是本课语法点的
 * 形式、使用条件与常见错误，而不是模型自己的印象。取不到就记缺口。
 */
async function loadGrammarEvidence(
  lessonContext: Record<string, unknown> | null,
  gaps: PackGap[],
): Promise<PackEvidence | null> {
  const grammar = typeof lessonContext?.grammar === "string" ? lessonContext.grammar : null;
  if (!grammar?.trim()) return null;
  const reference = await loadGrammarReference({ grammar, maxChars: MAX_GRAMMAR_CHARS });
  if (!reference) {
    gaps.push({
      kind: "no_grammar_reference",
      message: `本课语法（${grammar.split("\n")[0]?.trim()}）没有对应的语法参考，本次判断没有语法依据。`,
    });
    return null;
  }
  return {
    label: `语法参考 · ${reference.pointId} ${reference.topic}`,
    sourceRef: `grammar:${reference.pointId}`,
    layer: "authoritative_standards",
    page: null,
    ocrJobId: null,
    excerpt: reference.text,
  };
}

export async function buildSuggestionContextPack(
  input: SuggestionPackInput,
): Promise<SuggestionContextPack> {
  const store = getAppStore();
  const gaps: PackGap[] = [];

  const { text: markdown, truncated } = truncateForBudget(input.content, MAX_CONTENT_CHARS);
  if (truncated) {
    gaps.push({
      kind: "truncated",
      message: `正文超过 ${MAX_CONTENT_CHARS} 字符，本次只带了前 ${MAX_CONTENT_CHARS} 字符。`,
    });
  }

  // 版本：拿 Lesson Context 与来源证据都要它。没有就如实说明，不去猜大纲。
  const version = input.versionId ? await store.getModuleVersion(input.versionId) : null;
  const metadata =
    version && version.content && typeof version.content === "object"
      ? (version.content as { metadata?: unknown }).metadata
      : null;
  const lessonContext = lessonContextFrom(metadata);
  if (!lessonContext) {
    gaps.push({
      kind: "no_lesson_context",
      message: input.versionId
        ? "这一版没有记录本课目标（大纲），本次判断没有大纲依据。"
        : "本次没有指定所基于的版本，取不到本课目标（大纲）。",
    });
  }

  // 规则：生成规则与审校规则都进（都作为参考知识库）。
  const ruleSet = await resolveEffectiveRules({
    projectId: input.projectId,
    lessonId: input.lessonId,
    grade: input.grade,
    bookType: input.bookType,
    moduleKey: input.moduleKey,
  });
  const rules = ruleSet.allRules.map(ruleToPackRule);
  const conflicts = constraintConflicts(ruleSet.allRules).map((conflict) => ({
    key: conflict.key,
    summary: describeConflict(conflict),
  }));
  if (rules.length === 0) {
    gaps.push({
      kind: "no_rules",
      message: "本次没有生效规则，判断只能依据老师的要求与正文。",
    });
  }

  // 跨书上下文：同一 Lesson 的其他已确认内容（排除正在改的这个模块）。
  const related: SuggestionContextPack["related"] = [];
  if (input.lessonId) {
    const result = await loadRelatedVersions({
      lessonId: input.lessonId,
      excludeModuleId: version?.module_id,
      maxChars: MAX_RELATED_CHARS,
    });
    for (const item of result.versions) {
      related.push({
        label: `${item.bookType}/${item.moduleKey} ${item.moduleLabel}`,
        markdown: item.markdown,
      });
    }
    if (result.omitted > 0) {
      gaps.push({
        kind: "budget",
        message: `同一课的其他内容超出预算，本次少带了 ${result.omitted} 个模块。`,
      });
    }
    if (related.length === 0) {
      gaps.push({ kind: "no_related_content", message: "这一课还没有其他已确认的模块内容可参考。" });
    }
  }

  const evidence = await loadEvidence(input);
  // 本课语法点的参考放在最前：它是修改建议最直接的外部依据
  const grammarReference = await loadGrammarEvidence(lessonContext, gaps);
  if (grammarReference) evidence.unshift(grammarReference);
  if (evidence.length === 0) {
    gaps.push({
      kind: "no_reference_material",
      message:
        "本地工作区里没有已确认的参考资料（Cambridge 权威标准或教辅），本次判断没有外部依据；" +
        "不要用模型常识冒充参考资料。",
    });
  }

  return {
    teacherRequest: input.instruction,
    module: {
      bookType: input.bookType,
      moduleKey: input.moduleKey,
      moduleLabel: input.moduleLabel ?? input.moduleKey,
      lessonNumber: input.lessonNumber ?? null,
      lessonTitle: input.lessonTitle ?? null,
      versionId: input.versionId ?? null,
      versionNumber: version?.version_number ?? null,
      markdown,
    },
    lessonContext,
    rules: { entries: rules, conflicts },
    related,
    evidence,
    gaps,
  };
}
