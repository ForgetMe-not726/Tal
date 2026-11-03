import { NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { retryLibraryItem, LibraryError } from "@/lib/library/store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await ensureWorkspace();
    return NextResponse.json({ item: await retryLibraryItem(id) }, { status: 202 });
  } catch (error) {
    const status = error instanceof LibraryError ? 400 : 500;
    if (status === 500) console.error("[api/library/items/:id/retry] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
