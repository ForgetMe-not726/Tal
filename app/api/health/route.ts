import { NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { workspaceRoot } from "@/lib/workspace/paths";

export const runtime = "nodejs";

/** 桌面壳启动时轮询：服务已就绪、工作区可写，才打开窗口。 */
export async function GET() {
  try {
    await ensureWorkspace();
    return NextResponse.json({
      ok: true,
      version: process.env.APP_VERSION ?? "dev",
      workspace: workspaceRoot(),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
