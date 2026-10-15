/**
 * 让模型把老师的问题翻成**查询计划**（关键词 + 过滤条件）。
 *
 * 为什么需要：`DESIGN.md` 给的例子「查找 Let's say 中包含 environment 的核心词汇」
 * 按字面去搜一条也命不中——问题里混着模块名和检索意图。所以先用模型把它翻成结构化查询，
 * **再拿这份计划去本地检索**。
 *
 * 三条纪律：
 * 1. **模型只出计划，不写答案**。profile §7.4 要求"优先返回可核验的检索结果，
 *    而不是仅给模型总结"——结果就是检索命中，没有模型总结，也就没有编造空间。
 * 2. **计划要显示给老师看**："问题被理解成了什么"必须可见、可判断。
 * 3. **认不出的过滤条件一律丢掉并如实报告**，不拿去检索。
 *    AI 没配或解析失败时退回关键词直检，并注明"未做语义解析"。
 */

import { aiComplete } from "@/lib/ai/gateway";
import { extractKeywords, validatePlan, type AssistantPlan, type PlanContext } from "./plan.ts";

export type { AssistantPlan, PlanContext } from "./plan.ts";
export { extractKeywords, validatePlan } from "./plan.ts";

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const trimmed = fenced.trim();
  try {
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  } catch {
    // 落到对象截取兜底
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

const SYSTEM =
  "你是教材检索的查询规划节点。把老师的问题翻译成检索计划，**只输出 JSON**，不要回答问题、不要解释。";

function prompt(question: string, context: PlanContext): string {
  const known = [
    context.known.bookTypes?.length ? `可选书种：${context.known.bookTypes.join("、")}` : "",
    context.known.lessonNumbers?.length ? `可选 Lesson：${context.known.lessonNumbers.join("、")}` : "",
    context.known.moduleKeys?.length ? `可选模块标识：${context.known.moduleKeys.join("、")}` : "",
    "可选来源类型：source（旧版来源）、rule（规则）、version（当前项目正文）、reference（参考资料）",
  ]
    .filter(Boolean)
    .join("\n");
  return `老师的问题：${question}

工作区里实际存在的值：
${known}

只输出这个 JSON（给不出的字段省略，不要编造）：
{"keywords":["用于字面检索的关键词"],"bookType":"","lessonNumber":0,"moduleKey":"","sourceKind":""}

要求：
1. keywords 放**真正要检索的内容词**（如词汇、短语、语法点名），不要把"查找""包含""模块"这类功能词放进去。
2. **中英术语都给**：语法术语、词条常常只在书里以英文出现（如「反义疑问句」对应 question tag、
   「被动语态」对应 passive）。只给中文会搜不到，所以中英写法都要放进 keywords。
3. 过滤条件只能用上面列出的值；不确定就省略。
4. 不要输出答案或解释。`;
}

/**
 * 生成查询计划。AI 不可用或解析失败时**退回关键词直检**，并注明未做语义解析。
 */
export async function planQuery(question: string, context: PlanContext): Promise<AssistantPlan> {
  const fallback = (): AssistantPlan => ({
    keywords: extractKeywords(question),
    source: "keywords",
    note: "未做语义解析，按关键词直接检索。",
    dropped: [],
  });

  if (!context.aiAvailable) return fallback();
  try {
    const result = await aiComplete({
      task: "review",
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(question, context) }],
      maxTokens: 512,
    });
    const parsed = parseJson(result.text);
    if (!parsed || typeof parsed !== "object") return fallback();
    const plan = validatePlan(parsed as Record<string, unknown>, context);
    if (plan.keywords.length === 0) return fallback();
    return { ...plan, note: "已把问题解析成下面的查询计划。" };
  } catch {
    return fallback();
  }
}
