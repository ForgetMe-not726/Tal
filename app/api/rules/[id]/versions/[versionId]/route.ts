import { NextResponse } from "next/server";
import {
  parseConstraints,
  RuleServiceError,
  updateDraftVersion,
} from "@/lib/rules/service";

/** 修改草稿版本:PATCH /api/rules/[id]/versions/[versionId] */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  try {
    const body = (await request.json()) as {
      instruction?: string;
      constraints?: unknown;
      changeNote?: string;
    };
    if (!body.instruction?.trim()) {
      throw new RuleServiceError("规则说明不能为空");
    }
    const version = await updateDraftVersion(id, versionId, {
      instruction: body.instruction,
      constraints: parseConstraints(body.constraints ?? {}),
      changeNote: body.changeNote,
    });
    return NextResponse.json({ version });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/versions] PATCH failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
