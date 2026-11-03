import { NextResponse } from "next/server";
import { join, resolve, sep } from "node:path";
import { readBinary } from "@/lib/workspace/files";
import { readJson } from "@/lib/workspace/json";
import { ocrLibraryDir } from "@/lib/workspace/paths";
import type { OcrManifest } from "@/lib/ocr/types";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/**
 * 只读已确认 OCR 目录的产物，不依赖 `.app/jobs` 记录。
 *
 * 通用助手的原页证据不能因为任务记录被清理就失效；这里按目录名读取，
 * 仍然做目录内 containment 与扩展名白名单，避免把工作区变成任意文件服务器。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ dir: string; path: string[] }> },
) {
  const { dir, path } = await context.params;
  try {
    const dirName = decodeURIComponent(dir);
    if (!dirName || dirName.includes("/") || dirName.includes("\\") || dirName.includes("..")) {
      return NextResponse.json({ error: "目录名无效" }, { status: 400 });
    }
    const root = resolve(ocrLibraryDir(), dirName);
    const libraryRoot = resolve(ocrLibraryDir());
    if (root !== libraryRoot && !root.startsWith(`${libraryRoot}${sep}`)) {
      return NextResponse.json({ error: "目录超出资料库范围" }, { status: 400 });
    }
    const manifest = await readJson<OcrManifest | null>(join(root, "manifest.json"), null);
    if (!manifest || manifest.status !== "confirmed") {
      return NextResponse.json({ error: "这个 OCR 来源尚未确认" }, { status: 404 });
    }
    const relative = path.map((part) => decodeURIComponent(part)).join("/");
    const target = resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      return NextResponse.json({ error: "路径超出 OCR 目录" }, { status: 400 });
    }
    const extension = target.slice(target.lastIndexOf(".")).toLocaleLowerCase();
    const contentType = TYPES[extension];
    if (!contentType) {
      return NextResponse.json({ error: "不支持读取这个文件类型" }, { status: 400 });
    }
    const data = await readBinary(target);
    if (!data) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/ocr/library/raw] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
