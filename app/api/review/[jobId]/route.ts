import { NextResponse } from "next/server";
import {
  readDecisions,
  readFindings,
  readJobRecord,
  readManifest,
  saveDecision,
} from "@/lib/review/jobs";
import { cancelReview } from "@/lib/review/service";
import { ReviewError, type ReviewDecisionAction } from "@/lib/review/types";

export const runtime = "nodejs";

const ACTIONS: readonly string[] = ["adopt", "ignore", "recheck"];

/** 一次审校的完整结果：状态 + manifest + findings + decisions（界面轮询状态）。 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const record = await readJobRecord(jobId);
    const [manifest, findings, decisions] = await Promise.all([
      readManifest(record.projectId, record.lessonNumber, jobId).catch(() => null),
      readFindings(record.projectId, record.lessonNumber, jobId),
      readDecisions(record.projectId, record.lessonNumber, jobId),
    ]);
    return NextResponse.json({ job: record, manifest, findings, decisions });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/:id] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 保存老师对某一条问题的处理决定。 */
export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const findingId = typeof body.findingId === "string" ? body.findingId.trim() : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!findingId) throw new ReviewError("缺少问题标识");
    if (!ACTIONS.includes(action)) throw new ReviewError(`不支持的处理动作：${action}`);
    const record = await readJobRecord(jobId);
    const result = await saveDecision({
      projectId: record.projectId,
      lessonNumber: record.lessonNumber,
      jobId,
      findingId,
      action: action as ReviewDecisionAction,
      note: typeof body.note === "string" ? body.note : undefined,
      decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/:id] PATCH failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 取消审校。 */
export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    await cancelReview(jobId);
    return NextResponse.json({ job: await readJobRecord(jobId) });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/:id] DELETE failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
