import { NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { readLibraryItem, removeLibraryItem, LibraryError } from "@/lib/library/store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const item = await readLibraryItem(id);
  if (!item) return NextResponse.json({ error: "资料条目不存在" }, { status: 404 });
  return NextResponse.json({ item });
}

/** 移除资料：移到工作区回收区，不永久删除。 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await ensureWorkspace();
    return NextResponse.json({ ok: true, ...(await removeLibraryItem(id)) });
  } catch (error) {
    const status = error instanceof LibraryError ? 400 : 500;
    if (status === 500) console.error("[api/library/items/:id] DELETE failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
