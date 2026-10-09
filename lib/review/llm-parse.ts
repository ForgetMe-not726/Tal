/**
 * 解析模型返回的审校 Finding。
 *
 * 纪律与 `lib/suggestions/parse.ts` 一致：**不可解析时降级为一条说明性 Finding，
 * 绝不把自由文本当成结论**。模型返回的每条都要能被规则 ID 与原文定位支撑，
 * 否则它只是一段评论——评论不能进 `findings.json` 冒充检查结果。
 */

export type ParsedReviewFinding = {
  ruleKey: string;
  /**
   * 审校标准的三态结果里，Finding 能代表的那两态：
   * `needs_revision`（需要修改）与 `cannot_verify`（材料未提供无法核查）。
   * 「通过」不进 Finding——工作台目前只记问题（逐元素通过记录是已知缺口，见 question.md）。
   * 认不出的值一律按 `needs_revision`，不把模型的自述当"无法核查"用。
   */
  verdict: ReviewVerdict;
  originalText: string;
  message: string;
  suggestion: string;
  evidence: string;
  confidence: number | null;
};

export type ReviewVerdict = "needs_revision" | "cannot_verify";

function asVerdict(value: unknown): ReviewVerdict {
  return value === "cannot_verify" ? "cannot_verify" : "needs_revision";
}

function asConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const trimmed = fenced.trim();
  try {
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return JSON.parse(trimmed);
  } catch {
    // 继续走对象提取兜底：模型常在 JSON 前后附解释文字
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
 * 解析。`fallbackRuleKey` 在模型没写规则 ID 时用它（通常是本次审校里最相关的一条规则）——
 * 但**规则 ID 缺失的条目会被标成 insufficientEvidence**，由调用方决定要不要收。
 */
export function parseReviewFindings(
  raw: string,
): { findings: ParsedReviewFinding[]; parseFailed: boolean } {
  const parsed = parseJson(raw) as { findings?: unknown } | null;
  const items = Array.isArray(parsed) ? parsed : parsed?.findings;
  if (!Array.isArray(items)) {
    return { findings: [], parseFailed: true };
  }
  const findings = items
    .map((item) => {
      const value = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const message = text(value.message);
      if (!message) return null;
      return {
        ruleKey: text(value.rule_key),
        verdict: asVerdict(value.verdict),
        originalText: text(value.original_text),
        message,
        suggestion: text(value.suggestion),
        evidence: text(value.evidence),
        confidence: asConfidence(value.confidence),
      } satisfies ParsedReviewFinding;
    })
    .filter((item): item is ParsedReviewFinding => item !== null);
  return { findings, parseFailed: false };
}
