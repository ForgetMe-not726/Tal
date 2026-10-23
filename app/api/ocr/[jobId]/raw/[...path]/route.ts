import { NextResponse } from "next/server";
import { join, resolve, sep } from "node:path";
import { readBinary } from "@/lib/workspace/files";
import { ocrJobDir } from "@/lib/workspace/paths";
import { readJob } from "@/lib/ocr/jobs";
import { OcrError } from "@/lib/ocr/types";

export const runtime = "nodejs";

/**
 * 读取任务目录里的产物：正文、结构 JSON、页图、图片资产。
 *
 * 一个路由覆盖四类读取，省掉三份几乎一样的代码。安全边界在这里收口：
 * - 路径解析后必须**仍在任务目录内**（拒绝 `..`、绝对路径、符号链接逃逸）；
 * - 只服务白名单里的扩展名，且 Content-Type 由扩展名决定——
 *   绝不能把工作区里的任意文件当成 HTML 吐出去（profile §8）。
 */
const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> },
) {
  const { jobId, path } = await context.params;
  try {
    const job = await readJob(jobId);
    const jobDir = resolve(ocrJobDir(job.dirName ?? jobId));
    const relative = (path ?? []).join("/");
    if (!relative) throw new OcrError("缺少文件路径");

    const target = resolve(join(jobDir, relative));
    if (target !== jobDir && !target.startsWith(`${jobDir}${sep}`)) {
      throw new OcrError("路径超出任务目录范围");
    }

    const extension = target.slice(target.lastIndexOf(".")).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) throw new OcrError(`不支持读取这种文件：${extension}`);

    const data = await readBinary(target);
    if (!data) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr/:id/raw] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
