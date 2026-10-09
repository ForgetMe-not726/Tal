import { NextResponse } from "next/server";
import { deleteRuleDefinition, RuleServiceError } from "@/lib/rules/service";

/** 删除规则及其版本/绑定。正式删除前由前端确认。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteRuleDefinition(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/:id] DELETE failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
