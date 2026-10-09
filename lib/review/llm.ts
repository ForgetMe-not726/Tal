/**
 * LLM 审校阶段（I/O 部分）。
 *
 * 规则以**原文 + ID + 硬度 + 约束**进入 Prompt——不做自由摘要，也不让模型自己决定查什么
 * （`docs/AI-ASSISTANT-RETRIEVAL.md` §2 对规则压缩的要求，审校侧同理）。
 * 模型只负责"按给定规则找出问题并给证据与建议"，不负责发明规则。
 */

import { aiComplete } from "@/lib/ai/gateway";
import { parseReviewFindings, type ParsedReviewFinding } from "./llm-parse.ts";
import { buildReviewPrompt, type LlmReviewInput } from "./prompt.ts";

export { buildReviewPrompt, renderRules } from "./prompt.ts";
export type { LlmReviewInput } from "./prompt.ts";

export class ReviewLlmError extends Error {}

export type LlmReviewResult = {
  findings: ParsedReviewFinding[];
  parseFailed: boolean;
  engine: { provider: string; model: string };
};

export async function runLlmReview(input: LlmReviewInput): Promise<LlmReviewResult> {
  if (input.rules.length === 0) {
    throw new ReviewLlmError("本次没有生效规则，无法进行模型审校");
  }
  const result = await aiComplete({
    task: "review",
    system:
      "你是教材审校节点。只按给定规则找问题，必须给出正文定位与依据；资料不足时明说，不要编造。只输出 JSON。",
    messages: [{ role: "user", content: buildReviewPrompt(input) }],
    maxTokens: 4096,
  });
  if (result.stopReason === "max_tokens") {
    throw new ReviewLlmError("模型审校输出达到长度上限，请缩小审校范围后重试");
  }
  const parsed = parseReviewFindings(result.text);
  return {
    ...parsed,
    engine: { provider: result.provider, model: result.model },
  };
}
