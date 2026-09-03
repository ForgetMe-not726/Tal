import { NextResponse } from "next/server";
import { publishVersion, RuleServiceError } from "@/lib/rules/service";

/** 发布草稿版本(旧 Published 自动废弃):POST /api/rules/[id]/versions/[versionId]/publish */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  try {
    const version = await publishVersion(id, versionId);
    return NextResponse.json({ version });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/versions/publish] failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
