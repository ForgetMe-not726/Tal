import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { knowledgeDir, libraryDir, ocrLibraryDir, recycleDir, workspaceRoot } from "@/lib/workspace/paths";

export const runtime = "nodejs";

/** 只允许打开这三处，不接受任意路径（避免本地工具被当成通用命令执行器）。 */
const TARGETS: Record<string, () => string> = {
  workspace: workspaceRoot,
  ocr: ocrLibraryDir,
  knowledge: knowledgeDir,
  library: libraryDir,
  recycle: recycleDir,
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const target = typeof body.target === "string" ? body.target : "";
    const resolve = TARGETS[target];
    if (!resolve) return NextResponse.json({ error: "不支持打开这个位置" }, { status: 400 });
    await ensureWorkspace();
    const path = resolve();
    const command =
      process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(command, [path], { detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    console.error("[api/library/open] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
