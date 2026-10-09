import type { ContentSuggestion } from "@/lib/types";

function asSeverity(value: unknown): ContentSuggestion["severity"] {
  return value === "error" || value === "warning" ? value : "info";
}

function asKind(value: unknown): ContentSuggestion["kind"] {
  return value === "replace" || value === "insert" || value === "delete" ? value : "note";
}

function asConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

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
export function parseSuggestions(raw: string): ContentSuggestion[] {
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
        severity: "warning",
        confidence: null,
      },
    ];
  }
  return items.map((item, index) => {
    const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof value.id === "string" ? value.id : `suggestion-${index + 1}`,
      kind: asKind(value.kind),
      originalText: typeof value.original_text === "string" ? value.original_text : "",
      replacementText: typeof value.replacement_text === "string" ? value.replacement_text : "",
      reason: typeof value.reason === "string" ? value.reason : "未提供原因",
      severity: asSeverity(value.severity),
      confidence: asConfidence(value.confidence),
    };
  });
}
