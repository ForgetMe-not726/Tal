import { NextResponse } from "next/server";
import { isAbsolute } from "node:path";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { importLibraryFiles, importLibraryFolder, startLibraryIndexing, LibraryError } from "@/lib/library/store";

export const runtime = "nodejs";

/**
 * 导入老师在原生选择框里选中的 PDF/Markdown。
 *
 * 路径来自桌面壳的文件选择器，不接受前端手填；复制、类型/大小校验和索引都在
 * 本机服务里完成。索引异步跑，路由立即返回，资料库页面轮询状态。
 */
export async function POST(request: Request) {
  try {
    await ensureWorkspace();
    const body = (await request.json()) as Record<string, unknown>;
    const mode = body.mode === "folder" ? "folder" : "files";
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (paths.length === 0) throw new LibraryError("没有选择资料");
    if (paths.some((item) => !isAbsolute(item))) {
      throw new LibraryError("资料路径必须是本机绝对路径");
    }
    if (mode === "folder" && paths.length !== 1) throw new LibraryError("一次只能导入一个文件夹");

    const items = mode === "folder" ? [await importLibraryFolder(paths[0])] : await importLibraryFiles(paths);
    for (const item of items) startLibraryIndexing(item.id);
    return NextResponse.json({ items }, { status: 202 });
  } catch (error) {
    const status = error instanceof LibraryError ? 400 : 500;
    if (status === 500) console.error("[api/library/items] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
