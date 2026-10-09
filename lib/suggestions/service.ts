import { aiComplete } from "@/lib/ai/gateway";
import type { BookType, Grade } from "@/lib/db/types";
import { renderSuggestionPrompt, type SuggestionContextPack } from "@/lib/suggestions/context-pack";
import { buildSuggestionContextPack } from "@/lib/suggestions/pack-source";
import { writeSuggestionRun } from "@/lib/suggestions/jobs";
import { parseSuggestions } from "@/lib/suggestions/parse";
import type { ContentSuggestion } from "@/lib/types";

export class SuggestionServiceError extends Error {}

export type SuggestionRequest = {
  content: string;
  instruction: string;
  grade: Grade;
  bookType: BookType;
  moduleKey: string;
  moduleLabel?: string;
  projectId?: string;
  lessonId?: string;
  lessonNumber?: number;
  lessonTitle?: string;
  /** 草稿所基于的版本；有它才能取 Lesson Context 与来源证据。 */
  versionId?: string;
};

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SuggestionServiceError(`${label}不能为空`);
  }
  return value.trim();
}

export function normalizeSuggestionInput(raw: Record<string, unknown>): SuggestionRequest {
  const grade = text(raw.grade, "年级") as Grade;
  const bookType = text(raw.bookType, "书种") as BookType;
  if (!["L1", "L2", "L3", "L4", "L5", "L6"].includes(grade)) {
    throw new SuggestionServiceError("年级必须是 L1-L6");
  }
  if (!["student", "workbook", "knowledge", "vocab"].includes(bookType)) {
    throw new SuggestionServiceError("书种不受支持");
  }
  const optional = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const lessonNumber = typeof raw.lessonNumber === "number" && Number.isInteger(raw.lessonNumber) ? raw.lessonNumber : undefined;
  return {
    content: text(raw.content, "正文"),
    instruction: text(raw.instruction, "修改要求"),
    grade,
    bookType,
    moduleKey: text(raw.moduleKey, "模块标识"),
    moduleLabel: optional(raw.moduleLabel),
    projectId: optional(raw.projectId),
    lessonId: optional(raw.lessonId),
    lessonNumber,
    lessonTitle: optional(raw.lessonTitle),
    versionId: optional(raw.versionId),
  };
}

export type SuggestionResult = {
  /** 诊断记录 id（`.app/jobs/suggestions/`），供老师追问"这次到底发了什么"。 */
  jobId: string;
  suggestions: ContentSuggestion[];
  /** 本次资料缺口：没有参考资料、没有大纲、正文被截断等。 */
  gaps: SuggestionContextPack["gaps"];
  /** 规则之间的约束冲突（同一约束被设成了不同的值）。 */
  conflicts: SuggestionContextPack["rules"]["conflicts"];
  /** 本次进了 Context Pack 的规则（界面据此把规则 ID 显示成规则名）。 */
  rules: Array<{ ruleKey: string; displayName: string; isHard: boolean; scope: string }>;
  ai: { provider: string; model: string; usage: unknown; latencyMs: number };
};

export async function generateSuggestions(request: SuggestionRequest): Promise<SuggestionResult> {
  const pack = await buildSuggestionContextPack({
    projectId: request.projectId,
    lessonId: request.lessonId,
    lessonNumber: request.lessonNumber,
    lessonTitle: request.lessonTitle,
    grade: request.grade,
    bookType: request.bookType,
    moduleKey: request.moduleKey,
    moduleLabel: request.moduleLabel,
    content: request.content,
    instruction: request.instruction,
    versionId: request.versionId,
  });

  const result = await aiComplete({
    task: "review",
    system:
      "你是教材编辑建议节点。只提出建议，不直接改写用户正文。" +
      "老师的要求是本次任务目标；规则是判断依据，不要逐条机械对照。" +
      "必须输出 JSON 对象，不要输出 Markdown 围栏外的解释。",
    messages: [{ role: "user", content: renderSuggestionPrompt(pack) }],
    maxTokens: 4096,
  });
  if (result.stopReason === "max_tokens") {
    throw new SuggestionServiceError("建议输出达到长度上限，请缩小正文或修改要求后重试");
  }

  const suggestions = parseSuggestions(result.text, {
    ruleKeys: pack.rules.entries.map((rule) => rule.ruleKey),
    evidence: pack.evidence,
  });

  const jobId = await writeSuggestionRun({
    instruction: request.instruction,
    pack,
    prompt: renderSuggestionPrompt(pack),
    rawResponse: result.text,
    suggestionCount: suggestions.length,
    ai: { provider: result.provider, model: result.model, latencyMs: result.latencyMs },
  });

  return {
    jobId,
    suggestions,
    gaps: pack.gaps,
    conflicts: pack.rules.conflicts,
    rules: pack.rules.entries.map((rule) => ({
      ruleKey: rule.ruleKey,
      displayName: rule.displayName,
      isHard: rule.isHard,
      scope: rule.scope,
    })),
    ai: {
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    },
  };
}
