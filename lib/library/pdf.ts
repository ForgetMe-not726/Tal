/**
 * 资料库 PDF 的本地文字抽取与单页渲染。
 *
 * 复用随包 venv 的 pypdfium2：数字版 PDF 直接读文字层，扫描版没有文字时再由
 * 资料库 OCR 后台任务走 MinerU。渲染页图只按需做单页，导入时不为整本生成图片。
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mineruPython } from "../ocr/mineru.ts";
import { DEFAULT_PAGE_IMAGE } from "../ocr/page-names.ts";

export type ExtractedPage = { index: number; text: string; chars: number };
export type PdfTextResult = { pageCount: number; pages: ExtractedPage[] };

const EXTRACT_SCRIPT = [
  "import sys, json",
  "import pypdfium2 as pdfium",
  "doc = pdfium.PdfDocument(sys.argv[1])",
  "out = []",
  "for i, page in enumerate(doc):",
  "    try:",
  "        tp = page.get_textpage()",
  "        text = tp.get_text_range()",
  "        tp.close()",
  "    except Exception:",
  "        text = ''",
  "    out.append({'index': i, 'text': text, 'chars': len(''.join(text.split()))})",
  "open(sys.argv[2], 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False))",
  "print(len(out))",
].join("\n");

function runPython(args: string[], timeoutMs = 180_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(mineruPython(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("PDF 处理超时"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** 抽取逐页文字；扫描件会返回空文本，由调用方决定是否 OCR。 */
export async function extractPdfText(pdfPath: string): Promise<PdfTextResult> {
  const dir = await mkdtemp(join(tmpdir(), "library-pdf-"));
  const output = join(dir, "pages.json");
  try {
    const result = await runPython(["-I", "-c", EXTRACT_SCRIPT, pdfPath, output]);
    if (result.code !== 0) {
      throw new Error(`PDF 文字抽取失败（退出码 ${result.code}）：${result.stderr.trim().split("\n").slice(-3).join(" / ")}`);
    }
    const raw = await readFile(output, "utf8");
    const pages = JSON.parse(raw) as ExtractedPage[];
    if (!Array.isArray(pages) || pages.length === 0) throw new Error("PDF 没有可读取的页面");
    if (pages.length > 2000) throw new Error("PDF 页数超过 2000 页，资料库暂不支持");
    return { pageCount: pages.length, pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const RENDER_ONE_SCRIPT = [
  "import sys, pathlib",
  "import pypdfium2 as pdfium",
  "pdf, out, index, dpi, quality = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])",
  "doc = pdfium.PdfDocument(pdf)",
  "page = doc[index]",
  "image = page.render(scale=dpi / 72).to_pil().convert('RGB')",
  "pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)",
  "image.save(out, quality=quality)",
  "print('ok')",
].join("\n");

/** 只渲染一页到指定路径；页面图缺失时由资料库路由按需调用。 */
export async function renderPdfPage(pdfPath: string, pageIndex: number, output: string): Promise<void> {
  const options = DEFAULT_PAGE_IMAGE;
  const result = await runPython(
    ["-I", "-c", RENDER_ONE_SCRIPT, pdfPath, output, String(pageIndex), String(options.dpi), String(options.quality)],
    120_000,
  );
  if (result.code !== 0) {
    throw new Error(`PDF 页图渲染失败（退出码 ${result.code}）：${result.stderr.trim().split("\n").slice(-3).join(" / ")}`);
  }
}
