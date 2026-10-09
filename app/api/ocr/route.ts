import { NextResponse } from "next/server";
import { join } from "node:path";
import { readHead, saveStreamToWorkspace } from "@/lib/workspace/files";
import { originalsDir } from "@/lib/workspace/paths";
import { getAppStore } from "@/lib/db/store";
import {
  MAX_ORIGINAL_BYTES,
  assertBookType,
  assertImportable,
  listJobViews,
} from "@/lib/ocr/jobs";
import { engineStatus, startImport, startRecognition } from "@/lib/ocr/service";
import { OcrError } from "@/lib/ocr/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 新建识别任务 / 列出任务。
 *
 * **上传不走 multipart**：教材 PDF 实测 209 MB，`request.formData()` 会把整个 body
 * 读进内存（现有唯一的 multipart 先例限 12 MB）。这里把请求体**流式**写进
 * `sources/originals/`，实测 209 MB 用时 <1s、内存增量约 30 MB。
 *
 * 另一种入口是 `{ upstreamDir }`——导入已经跑过的 OCR 产物（PRODUCT.md §4.1
 * 的"选择 PDF、图片或已处理资料"），不重新识别。
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      const projectId = String(body.projectId ?? "").trim();
      if (!projectId) throw new OcrError("缺少项目");
      const job = await startImport({
        projectId,
        bookType: assertBookType(body.bookType),
        upstreamDir: String(body.upstreamDir ?? "").trim(),
        originalPath: typeof body.originalPath === "string" ? body.originalPath : undefined,
        originalName: typeof body.originalName === "string" ? body.originalName : undefined,
        method: typeof body.method === "string" ? body.method : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
      });
      return NextResponse.json({ job }, { status: 201 });
    }

    const projectId = String(url.searchParams.get("projectId") ?? "").trim();
    if (!projectId) throw new OcrError("缺少项目");
    const project = await getAppStore().getProjectById(projectId);
    if (!project) throw new OcrError("项目不存在");
    const bookType = assertBookType(url.searchParams.get("bookType"));
    const originalName = assertImportable(url.searchParams.get("fileName") ?? "");
    if (!request.body) throw new OcrError("请求体为空，没有收到文件");

    const ready = await engineStatus();
    if (!ready.ready) throw new OcrError(ready.reason ?? "OCR 引擎不可用");

    const target = join(originalsDir(projectId), originalName);
    const bytes = await saveStreamToWorkspace(request.body, target, {
      maxBytes: MAX_ORIGINAL_BYTES,
    });
    if (bytes === 0) throw new OcrError("文件是空的");

    // 按内容认类型，不靠扩展名
    const head = await readHead(target, 5);
    const isPdf = head.toString("latin1") === "%PDF-";
    const isImage = head[0] === 0xff && head[1] === 0xd8;
    if (!isPdf && !isImage) {
      throw new OcrError("这个文件既不是 PDF 也不是图片，请确认后再导入");
    }

    const job = await startRecognition({
      projectId,
      bookType,
      originalName,
      originalPath: target,
      originalBytes: bytes,
    });
    return NextResponse.json({ job, bytes }, { status: 201 });
  } catch (error) {
    const status = error instanceof OcrError ? 400 : 500;
    if (status === 500) console.error("[api/ocr] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() || undefined;
    const bookType = url.searchParams.get("bookType")?.trim() || undefined;
    const jobs = await listJobViews({ projectId });
    const filtered = bookType ? jobs.filter((job) => job.bookType === bookType) : jobs;
    const engine = await engineStatus();
    return NextResponse.json({ jobs: filtered, engine });
  } catch (error) {
    console.error("[api/ocr] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
