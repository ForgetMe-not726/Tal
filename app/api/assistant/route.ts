import { NextResponse } from "next/server";
import { activeAdapter } from "@/lib/assistant/adapter";
import { collectCorpora } from "@/lib/assistant/local-search";
import { planQuery } from "@/lib/assistant/planner";
import { AssistantError, type AssistantQuery, type AssistantScope, type AssistantSourceKind } from "@/lib/assistant/types";
import { aiConfigured } from "@/lib/ai/gateway";

export const runtime = "nodejs";

const SCOPES: readonly AssistantScope[] = ["workspace", "project"];
const SOURCE_KINDS: readonly AssistantSourceKind[] = ["source", "rule", "version", "reference", "exemplar"];

function normalize(body: Record<string, unknown>): AssistantQuery {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) throw new AssistantError("请先写下要查什么");
  const scope = SCOPES.includes(body.scope as AssistantScope) ? (body.scope as AssistantScope) : "workspace";
  if (scope === "project" && typeof body.projectId !== "string") {
    throw new AssistantError("按项目检索需要指定项目");
  }
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.min(50, Math.max(1, body.limit)) : undefined;
  return {
    query,
    scope,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    bookType: typeof body.bookType === "string" ? (body.bookType as AssistantQuery["bookType"]) : undefined,
    lessonNumber: typeof body.lessonNumber === "number" ? body.lessonNumber : undefined,
    moduleKey: typeof body.moduleKey === "string" && body.moduleKey.trim() ? body.moduleKey.trim() : undefined,
    sourceKind: SOURCE_KINDS.includes(body.sourceKind as AssistantSourceKind)
      ? (body.sourceKind as AssistantSourceKind)
      : undefined,
    limit,
    needPageEvidence: body.needPageEvidence === true,
  };
}

/**
 * 通用助手的只读检索（`docs/AI-ASSISTANT-RETRIEVAL.md` §4）。
 *
 * 两步：**先把问题翻成查询计划**（模型，可退回关键词），**再拿计划去本地检索**。
 * 返回的是可核验的命中，没有模型总结——老师要的是能回到书上的证据，不是一段转述。
 * 这个路由**只读**：不写正文、不改规则、不产生审校结论。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const query = normalize(body);

    // 校验模型给的过滤条件要用工作区里真实存在的值，所以先取一遍语料
    const corpora = await collectCorpora(query);
    const plan = await planQuery(query.query, {
      known: {
        bookTypes: ["student", "workbook", "knowledge", "vocab"],
        lessonNumbers: [...new Set(corpora.lessons.map((item) => item.lesson.lesson_number))].sort((a, b) => a - b),
        moduleKeys: [...new Set(corpora.versions.map((item) => item.moduleKey))].sort(),
      },
      aiAvailable: aiConfigured(),
    });

    // 老师的显式过滤优先于模型的推断
    const merged: AssistantQuery = {
      ...query,
      bookType: query.bookType ?? plan.bookType,
      lessonNumber: query.lessonNumber ?? plan.lessonNumber,
      moduleKey: query.moduleKey ?? plan.moduleKey,
      sourceKind: query.sourceKind ?? plan.sourceKind,
      query: plan.keywords.join(" ") || query.query,
    };

    const adapter = activeAdapter();
    const result = await adapter.search(merged);
    return NextResponse.json({
      adapter: { name: adapter.name, description: adapter.description },
      plan: { ...plan, keywords: merged.query.split(/\s+/u).filter(Boolean) },
      ...result,
    });
  } catch (error) {
    const status = error instanceof AssistantError ? 400 : 500;
    if (status === 500) console.error("[api/assistant] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
