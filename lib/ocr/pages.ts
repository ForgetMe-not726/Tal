/**
 * 整页页图。
 *
 * **引擎不产出整页图**：MinerU 的 `images/` 全是区域裁切（表格、插图），
 * `_layout.pdf` / `_span.pdf` 是叠了框的原件（学生用书这两份合计 544 MB，不能进工作区）。
 * 而 profile §3 要求 OCR 产物里有 `pages/`，界面也要靠它把原页当证据。
 *
 * 渲染用 venv 里现成的 **pypdfium2**（实测可用；`pymupdf`/`fitz` 在这个环境里没有装）。
 * 渲染源用 `_origin.pdf`——它是引擎按页码区间切过的版本，页码天然与 `page_idx` 对齐。
 *
 * 参数（格式/DPI/质量）写进 manifest，页图因此是**可重建**的。
 */

import { spawn } from "node:child_process";
import { DEFAULT_PAGE_IMAGE, pageImageName, type PageImageOptions } from "./page-names.ts";

// 命名与参数在 `page-names.ts`（客户端也能引用）；这里转出去，原有的引用点不用改。
export { DEFAULT_PAGE_IMAGE, pageImageName };
export type { PageImageOptions };

/** 渲染脚本（多行 Python，作为**单个 argv** 传给 `python -c`，不经过 shell）。 */
const RENDER_SCRIPT = [
  "import sys, pathlib",
  "import pypdfium2 as pdfium",
  "pdf, out, dpi, fmt, quality = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], int(sys.argv[5])",
  "doc = pdfium.PdfDocument(pdf)",
  "outdir = pathlib.Path(out)",
  "outdir.mkdir(parents=True, exist_ok=True)",
  "ext = 'jpg' if fmt == 'jpeg' else 'png'",
  "for i in range(len(doc)):",
  "    image = doc[i].render(scale=dpi / 72).to_pil()",
  "    target = outdir / f'p{i:04d}.{ext}'",
  "    if fmt == 'jpeg':",
  "        image.convert('RGB').save(target, quality=quality)",
  "    else:",
  "        image.save(target)",
  "print(f'rendered {len(doc)} pages')",
].join("\n");

/** 渲染命令（纯函数，便于单测）。 */
export function renderPagesCommand(input: {
  pythonExe: string;
  pdfPath: string;
  outDir: string;
  options?: PageImageOptions;
}): string[] {
  const options = input.options ?? DEFAULT_PAGE_IMAGE;
  return [
    input.pythonExe,
    "-c",
    RENDER_SCRIPT,
    input.pdfPath,
    input.outDir,
    String(options.dpi),
    options.format,
    String(options.quality),
  ];
}

export type RenderResult = { pageCount: number; stdout: string; stderr: string };

/**
 * 读 PDF 的**真实页数**（pypdfium2）。
 *
 * 为什么不从 MinerU 的日志里取：它的 tqdm 进度条混着**区域数**（`OCR-rec Predict: 852/954`
 * 是文字区域、`OCR-det: 12/17` 是检测批次），当页数显示会得到离谱的数字
 * （实测一本 83 页的书显示成 1314/1668 页）。页数只有 PDF 自己说了算。
 */
export async function countPdfPages(pdfPath: string, pythonExe: string): Promise<number | null> {
  const script = [
    "import sys",
    "import pypdfium2 as pdfium",
    "doc = pdfium.PdfDocument(sys.argv[1])",
    "print(len(doc))",
  ].join("\n");
  return new Promise((resolvePromise) => {
    const child = spawn(pythonExe, ["-I", "-c", script, pdfPath], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolvePromise(null));
    child.on("close", (code) => {
      const value = Number(stdout.trim());
      resolvePromise(code === 0 && Number.isInteger(value) && value > 0 ? value : null);
    });
  });
}

/** 跑一次页图渲染。失败抛错，错误里带 stderr 尾部（可诊断）。 */
export async function renderPageImages(input: {
  pythonExe: string;
  pdfPath: string;
  outDir: string;
  options?: PageImageOptions;
}): Promise<RenderResult> {
  const [command, ...args] = renderPagesCommand(input);
  return new Promise<RenderResult>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(`页图渲染失败（退出码 ${code}）：${stderr.trim().split("\n").slice(-3).join(" / ")}`),
        );
        return;
      }
      const match = /rendered (\d+) pages/.exec(stdout);
      resolvePromise({
        pageCount: match ? Number(match[1]) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
