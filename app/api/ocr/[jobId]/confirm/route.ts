import { NextResponse } from "next/server";
import { confirmJob } from "@/lib/ocr/jobs";
import { OcrError } from "@/lib/ocr/types";

export const runtime = "nodejs";

/**
 * 确认并加入资料库。
 *
 * 确认是**唯一**让 OCR 结果进入 Production Source 的动作（profile §5.1）：
 * 确认前 `manifest.status` 是 `ready`（待核对），制作页只列已确认的来源。
 */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const manifest = await confirmJob({
      jobId,
      confirmedBy: typeof body.confirmedBy === "string" ? body.confirmedBy : undefined,
    });
    return NextResponse.json({ manifest });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id/confirm] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
