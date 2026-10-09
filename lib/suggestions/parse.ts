import type { ContentSuggestion, SuggestionEvidence } from "@/lib/types";

function asKind(value: unknown): ContentSuggestion["kind"] {
  return value === "replace" || value === "insert" || value === "delete" ? value : "note";
}

function asConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 模型报的字符串列表（`rule_ids` / `evidence`）。 */
function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

/**
 * 本次 Pack 里有什么——用来校验模型报的依据。
 *
 * **给了白名单就只认白名单里的**：模型编一个不存在的规则 ID 或来源，比不给依据更糟，
 * 因为老师会以为那条结论有出处。这与审校侧处理模型规则 ID 的纪律一致。
 */
export type SuggestionParseContext = {
  ruleKeys?: readonly string[];
  evidence?: readonly SuggestionEvidence[];
};

function parseJson(textValue: string): unknown {
  const fenced = textValue.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? textValue;
  const trimmed = fenced.trim();
  try {
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return JSON.parse(trimmed);
  } catch {
    // 继续走对象提取兜底,覆盖模型在 JSON 前后附带解释文字的情况。
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析模型返回的建议。不可解析的输出只作为人工参考(note),
 * 绝不携带可执行的 replacementText,避免被直接写入正文。
 */
export function parseSuggestions(
  raw: string,
  context: SuggestionParseContext = {},
): ContentSuggestion[] {
  const parsed = parseJson(raw) as { suggestions?: unknown } | null;
  const items = Array.isArray(parsed) ? parsed : parsed?.suggestions;
  if (!Array.isArray(items)) {
    return [
      {
        id: "suggestion-1",
        kind: "note",
        originalText: "",
        replacementText: "",
        reason: raw.trim()
          ? `模型返回了不可解析的建议，请人工查看:${raw.trim().slice(0, 500)}`
          : "模型未返回可解析的结构化建议，请人工查看。",
        confidence: null,
      },
    ];
  }
  const evidenceByRef = new Map((context.evidence ?? []).map((item) => [item.sourceRef, item]));
  const knownRules = context.ruleKeys ? new Set(context.ruleKeys) : null;

  return items.map((item, index) => {
    const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    // 依据校验：有白名单时，不在里面的规则 ID 与来源一律丢掉
    const ruleKeys = asStringList(value.rule_ids).filter((key) => !knownRules || knownRules.has(key));
    const evidence = asStringList(value.evidence)
      .map((ref) => evidenceByRef.get(ref))
      .filter((entry): entry is SuggestionEvidence => Boolean(entry));
    const uncertainty = asText(value.uncertainty);
    return {
      id: typeof value.id === "string" ? value.id : `suggestion-${index + 1}`,
      kind: asKind(value.kind),
      originalText: typeof value.original_text === "string" ? value.original_text : "",
      replacementText: typeof value.replacement_text === "string" ? value.replacement_text : "",
      reason: typeof value.reason === "string" ? value.reason : "未提供原因",
      confidence: asConfidence(value.confidence),
      ...(ruleKeys.length > 0 ? { ruleKeys } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(uncertainty ? { uncertainty } : {}),
    };
  });
}
