import { NextResponse } from "next/server";
import { listConfirmedSources } from "@/lib/ocr/jobs";
import { ensureOcrLibraryLayout } from "@/lib/ocr/library";
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
    // 不给 projectId 就列整个工作区的已确认来源：老师不需要按项目切换
    const projectId = url.searchParams.get("projectId")?.trim() || undefined;
    const bookType = url.searchParams.get("bookType")?.trim() || undefined;
    // 迁移到可读的资料库文件夹（幂等）：老师直接打开目录就能找到
    await ensureOcrLibraryLayout();
    const sources = await listConfirmedSources({ projectId, bookType: bookType as never });
    return NextResponse.json({ sources });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/sources] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
