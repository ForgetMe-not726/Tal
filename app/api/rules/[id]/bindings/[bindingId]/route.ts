import { NextResponse } from "next/server";
import { deleteRuleBinding } from "@/lib/rules/bindings";
import { RuleServiceError } from "@/lib/rules/service";

/** 删除规则作用域绑定: DELETE /api/rules/[id]/bindings/[bindingId] */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id, bindingId } = await params;
  try {
    await deleteRuleBinding(id, bindingId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/bindings] DELETE failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
