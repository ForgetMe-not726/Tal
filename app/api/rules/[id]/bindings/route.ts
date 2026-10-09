import { NextResponse } from "next/server";
import {
  createRuleBinding,
  listRuleBindings,
  type RuleBindingInput,
} from "@/lib/rules/bindings";
import { RuleServiceError } from "@/lib/rules/service";

/** 读取/创建规则作用域绑定: /api/rules/[id]/bindings */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json({ bindings: await listRuleBindings(id) });
  } catch (error) {
    console.error("[api/rules/bindings] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Partial<RuleBindingInput>;
    if (!body.scope) throw new RuleServiceError("作用域不能为空");
    const binding = await createRuleBinding(id, {
      scope: body.scope,
      projectId: body.projectId,
      grade: body.grade,
      bookType: body.bookType,
      moduleKey: body.moduleKey,
      lessonId: body.lessonId,
    });
    return NextResponse.json({ binding }, { status: 201 });
  } catch (error) {
    const status = error instanceof RuleServiceError ? 400 : 500;
    if (status === 500) console.error("[api/rules/bindings] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
