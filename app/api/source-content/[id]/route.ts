import { NextResponse } from "next/server";
import {
  confirmSourceModule,
  KnowledgeRepositoryError,
} from "@/lib/knowledge/repository";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { confirmedText?: unknown; confirmedBy?: unknown };
    if (typeof body.confirmedText !== "string" || !body.confirmedText.trim()) {
      throw new KnowledgeRepositoryError("人工核对后的正文不能为空");
    }
    return NextResponse.json(
      await confirmSourceModule(
        id,
        body.confirmedText,
        typeof body.confirmedBy === "string" && body.confirmedBy.trim() ? body.confirmedBy : "teacher",
      ),
    );
  } catch (error) {
    const status = error instanceof KnowledgeRepositoryError ? 400 : 500;
    if (status === 500) console.error("[api/source-content/:id] PATCH failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
