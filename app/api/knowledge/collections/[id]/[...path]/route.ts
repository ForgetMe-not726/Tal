import { NextResponse } from "next/server";
import { join, resolve, sep } from "node:path";
import { readBinary } from "@/lib/workspace/files";
import { collectionsRoot } from "@/lib/knowledge/collections";

export const runtime = "nodejs";

/**
 * 读取知识库集合里的静态产物（页图、OCR 结构、原件）。
 *
 * 与 OCR 的产物读取同一套安全边界：路径解析后必须仍在集合目录内（拒绝 `..`、
 * 绝对路径、符号链接逃逸），只服务白名单扩展名，Content-Type 由扩展名决定。
 */
const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await context.params;
  try {
    const collectionDir = resolve(collectionsRoot(), id);
    const identifier = resolve(collectionsRoot());
    if (collectionDir !== identifier && !collectionDir.startsWith(`${identifier}${sep}`)) {
      return NextResponse.json({ error: "集合标识不合法" }, { status: 400 });
    }
    const relative = (path ?? []).join("/");
    if (!relative) return NextResponse.json({ error: "缺少文件路径" }, { status: 400 });

    const target = resolve(join(collectionDir, relative));
    if (target !== collectionDir && !target.startsWith(`${collectionDir}${sep}`)) {
      return NextResponse.json({ error: "路径超出集合目录范围" }, { status: 400 });
    }
    const extension = target.slice(target.lastIndexOf(".")).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) return NextResponse.json({ error: `不支持读取这种文件：${extension}` }, { status: 400 });

    const data = await readBinary(target);
    if (!data) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/knowledge/collections/:id/raw] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
