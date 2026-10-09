/**
 * 修改建议的运行记录（`.app/jobs/suggestions/<id>.json`）。
 *
 * 记的是**这次让模型看了什么、它回了什么**：老师能问"你到底把什么发过去了"，
 * 出问题时也能复现。
 *
 * 但它是**可重建的诊断物，不是事实源**（`docs/AI-ASSISTANT-RETRIEVAL.md` §2）：
 * 删掉不丢任何东西——正文在版本里，规则在规则库里，来源在工作区。
 * 因此这里**只写不读**，没有对应的读取接口。
 */

import { randomUUID } from "node:crypto";
import { writeJson } from "../workspace/json.ts";
import { suggestionJobFile } from "../workspace/paths.ts";
import type { SuggestionContextPack } from "./context-pack.ts";

export type SuggestionRunRecord = {
  id: string;
  createdAt: string;
  /** 老师的原始要求。 */
  instruction: string;
  /** 本次的 Context Pack（含规则、冲突、缺口、参考资料定位）。 */
  pack: SuggestionContextPack;
  /** 实际发出去的 Prompt 全文。 */
  prompt: string;
  /** 模型原始返回，便于排查"为什么解析出这样的建议"。 */
  rawResponse: string;
  suggestionCount: number;
  ai: { provider: string; model: string; latencyMs: number } | null;
};

export async function writeSuggestionRun(
  input: Omit<SuggestionRunRecord, "id" | "createdAt">,
): Promise<string> {
  const id = randomUUID();
  const record: SuggestionRunRecord = { id, createdAt: new Date().toISOString(), ...input };
  await writeJson(suggestionJobFile(id), record);
  return id;
}
