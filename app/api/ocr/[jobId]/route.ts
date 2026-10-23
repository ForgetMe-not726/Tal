import { NextResponse } from "next/server";
import { readJob, saveContent, readManifest, readStructure, toJobView } from "@/lib/ocr/jobs";
import { cancelJob, retryJob } from "@/lib/ocr/service";
import { OcrError } from "@/lib/ocr/types";

export const runtime = "nodejs";

/** 单个任务的状态与产物摘要（界面轮询这个接口）。 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const job = await readJob(jobId);
    // 产物还没生成时不报错，返回 null 让界面按状态显示
    const [manifest, structure] = await Promise.all([
      readManifest(jobId).catch(() => null),
      readStructure(jobId).catch(() => null),
    ]);
    return NextResponse.json({
      job: await toJobView(job),
      manifest,
      structure: structure
        ? { pageCount: structure.pageCount, pages: structure.pages, lowConfidence: structure.lowConfidence }
        : null,
    });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 保存老师对正文的修订（确认前可反复改）。 */
export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    if (!markdown.trim()) throw new OcrError("正文不能为空");
    await saveContent(jobId, markdown);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id] PATCH failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 取消识别（杀进程树，保留原文件）。 */
export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    return NextResponse.json({ job: await cancelJob(jobId) });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id] DELETE failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 任务里的其他动作：目前只有重试。 */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action !== "retry") throw new OcrError(`不支持的动作：${String(body.action)}`);
    return NextResponse.json({ job: await retryJob(jobId) });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
