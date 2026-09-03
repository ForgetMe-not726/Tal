import { NextResponse } from "next/server";
import {
  createDraftVersion,
  parseConstraints,
  RuleServiceError,
} from "@/lib/rules/service";

/** 为规则新建草稿版本:POST /api/rules/[id]/versions */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      instruction?: string;
      constraints?: unknown;
      changeNote?: string;
      createdBy?: string;
    };
    if (!body.instruction?.trim()) {
      throw new RuleServiceError("规则说明不能为空");
    }
    const version = await createDraftVersion(id, {
      instruction: body.instruction,
      constraints: parseConstraints(body.constraints ?? {}),
      changeNote: body.changeNote,
      createdBy: body.createdBy,
    });
    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/versions] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
