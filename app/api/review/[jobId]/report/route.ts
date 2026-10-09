import { NextResponse } from "next/server";
import { readFindings, readJobRecord, readManifest, readReport, writeReport } from "@/lib/review/jobs";
import { buildReviewReport } from "@/lib/review/report";
import { ReviewError } from "@/lib/review/types";

export const runtime = "nodejs";

/**
 * 生成审校报告。
 *
 * 报告由 `manifest + findings + decisions` 经**固定模板**生成（不调模型），
 * 因此可重建：删掉 `report.html` 再生成，结果一致。
 */
export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const record = await readJobRecord(jobId);
    if (record.status !== "ready") {
      throw new ReviewError("审校还没完成，暂时不能生成报告");
    }
    const manifest = await readManifest(record.projectId, record.lessonNumber, jobId);
    const findings = await readFindings(record.projectId, record.lessonNumber, jobId);
    const html = buildReviewReport(manifest, findings);
    await writeReport(record.projectId, record.lessonNumber, jobId, html);
    return NextResponse.json({ ok: true, bytes: Buffer.byteLength(html, "utf8") });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/:id/report] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

/** 读取报告 HTML 供软件内只读查看。 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  try {
    const record = await readJobRecord(jobId);
    const html = await readReport(record.projectId, record.lessonNumber, jobId);
    if (html == null) {
      return NextResponse.json({ error: "还没有生成报告" }, { status: 404 });
    }
    // 报告是静态展示物：不加脚本、不引远程资源（生成时已保证）
    return new NextResponse(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ReviewError ? 400 : 500;
    if (status === 500) console.error("[api/review/:id/report] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
