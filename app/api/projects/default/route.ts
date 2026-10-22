import { NextResponse } from "next/server";
import { workspaceProject } from "@/lib/workspace/default-project";

export const runtime = "nodejs";

/**
 * 工作区**默认项目**。
 *
 * 老师不需要选项目，所有页面用同一个；规则与识别侧一致（最早创建的那个，没有就建一个）。
 * 单独开一个接口是为了让"默认"只在一处定义——客户端不要各自按列表顺序猜。
 */
export async function GET() {
  try {
    return NextResponse.json({ project: await workspaceProject() });
  } catch (error) {
    console.error("[api/projects/default] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
