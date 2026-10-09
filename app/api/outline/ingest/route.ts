import { NextResponse } from "next/server";
import { parseOutlineWorkbook } from "@/lib/outline/xlsx";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * 大纲导入是工作台内部的透明步骤：只返回运行时投影，不写入知识库或正式规则库。
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) {
      return NextResponse.json({ error: "请选择一个 .xlsx 大纲文件" }, { status: 400 });
    }
    if (!value.name.toLocaleLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "目前只支持 .xlsx 大纲文件" }, { status: 400 });
    }
    if (value.size <= 0) return NextResponse.json({ error: "大纲文件为空" }, { status: 400 });
    if (value.size > MAX_FILE_BYTES) return NextResponse.json({ error: "大纲文件超过 12 MB 限制" }, { status: 400 });
    const profile = parseOutlineWorkbook(new Uint8Array(await value.arrayBuffer()), value.name, value.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return NextResponse.json({ profile, persisted: false }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "大纲解析失败";
    console.error("[api/outline/ingest] POST failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
