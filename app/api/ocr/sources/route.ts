import { NextResponse } from "next/server";
import { listConfirmedSources } from "@/lib/ocr/jobs";
import { OcrError } from "@/lib/ocr/types";

export const runtime = "nodejs";

/**
 * 本项目**已确认**的 OCR 来源——制作页左栏"从资料库选择"用它。
 *
 * 只列已确认的：待核对的结果是候选来源，不能进生成（profile §5.1）。
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim();
    if (!projectId) throw new OcrError("缺少项目");
    const bookType = url.searchParams.get("bookType")?.trim() || undefined;
    const sources = await listConfirmedSources({ projectId, bookType: bookType as never });
    return NextResponse.json({ sources });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/sources] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
