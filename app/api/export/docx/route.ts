import { NextResponse } from "next/server";
import { buildDocx, type DocxBlockInput } from "@/lib/export/docx";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 只接受正文 Markdown；导出不读数据库，工作台当前的稿子就是唯一来源。 */
function normalizeBlocks(value: unknown): DocxBlockInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      moduleKey: typeof item.moduleKey === "string" ? item.moduleKey : undefined,
      moduleLabel: typeof item.moduleLabel === "string" ? item.moduleLabel : "未命名模块",
      markdown: typeof item.markdown === "string" ? item.markdown : "",
    }))
    .filter((block) => block.markdown.trim().length > 0);
}

/** 中文文件名走 RFC 5987，同时给一个 ASCII 回退，老客户端也能存下来。 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** 把工作台已生成的模块导出为 DOCX，版式对齐新版知识清单成稿。 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const blocks = normalizeBlocks(body.blocks);
    if (blocks.length === 0) {
      return NextResponse.json({ error: "正文为空，暂不能导出" }, { status: 400 });
    }

    const rawName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 180) : "";
    const baseName = rawName.replace(/\.(md|markdown|docx)$/i, "") || "知识清单";
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : baseName;

    const buffer = await buildDocx({ title, blocks });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": DOCX_MIME,
        "content-disposition": contentDisposition(`${baseName}.docx`),
        "content-length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    console.error("[api/export/docx] POST failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
