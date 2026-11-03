import { NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { readLibraryPage } from "@/lib/library/store";

export const runtime = "nodejs";

/** 资料库 PDF 的按需页图；扫描件优先复用 OCR 产物。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";
  const page = Number(url.searchParams.get("page"));
  if (!file || !Number.isInteger(page) || page < 0) {
    return NextResponse.json({ error: "缺少文件或页码" }, { status: 400 });
  }
  try {
    await ensureWorkspace();
    const data = await readLibraryPage(id, file, page);
    if (!data) return NextResponse.json({ error: "页图不存在" }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/library/items/:id/page] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
