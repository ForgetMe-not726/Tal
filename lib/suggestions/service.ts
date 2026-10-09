import { aiComplete } from "@/lib/ai/gateway";
import { resolveEffectiveRules } from "@/lib/rules/resolver";
import type { BookType, Grade } from "@/lib/db/types";
import { parseSuggestions } from "@/lib/suggestions/parse";

export class SuggestionServiceError extends Error {}

export type SuggestionRequest = {
  content: string;
  instruction: string;
  grade: Grade;
  bookType: BookType;
  moduleKey: string;
  projectId?: string;
  lessonId?: string;
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
  return {
    content: text(raw.content, "正文"),
    instruction: text(raw.instruction, "修改要求"),
    grade,
    bookType,
    moduleKey: text(raw.moduleKey, "模块标识"),
    projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
    lessonId: typeof raw.lessonId === "string" ? raw.lessonId : undefined,
  };
}

export async function generateSuggestions(request: SuggestionRequest) {
  const rules = await resolveEffectiveRules({
    projectId: request.projectId,
    lessonId: request.lessonId,
    grade: request.grade,
    bookType: request.bookType,
    moduleKey: request.moduleKey,
  });
  const ruleText = rules.allRules
    .map(
      (item) =>
        `${item.rule.rule_key} v${item.version.version_number}${item.rule.is_hard ? " HARD" : ""}: ${item.version.instruction}\nconstraints=${JSON.stringify(item.version.constraints)}`,
    )
    .join("\n\n");
  const result = await aiComplete({
    task: "review",
    system:
      "你是教材编辑建议节点。只提出建议，不直接改写用户正文。必须输出 JSON 对象，不要输出 Markdown 围栏外的解释。",
    messages: [
      {
        role: "user",
        content: `请根据用户的修改要求，为以下教材模块提出可逐条采用或忽略的建议。不要臆测未提供的正式规则。\n\n【修改要求】\n${request.instruction}\n\n【模块】\n${request.bookType}/${request.moduleKey}\n\n【生效规则】\n${ruleText || "（无）"}\n\n【正文】\n${request.content}\n\n返回格式：{"suggestions":[{"kind":"replace|insert|delete|note","original_text":"","replacement_text":"","reason":"","severity":"info|warning|error","confidence":0.0}]}`,
      },
    ],
    maxTokens: 4096,
  });
  if (result.stopReason === "max_tokens") {
    throw new SuggestionServiceError("建议输出达到长度上限，请缩小正文或修改要求后重试");
  }
  return {
    suggestions: parseSuggestions(result.text),
    ai: {
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    },
    rules: rules.snapshot,
  };
}
