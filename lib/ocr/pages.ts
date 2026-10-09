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

export type PageImageOptions = {
  format: "jpeg" | "png";
  dpi: number;
  quality: number;
};

/** 默认页图参数：实测学生用书 131 页落在约 30–50 MB。 */
export const DEFAULT_PAGE_IMAGE: PageImageOptions = { format: "jpeg", dpi: 150, quality: 85 };

export function pageImageName(index: number, format: PageImageOptions["format"] = "jpeg"): string {
  return `p${String(index).padStart(4, "0")}.${format === "jpeg" ? "jpg" : "png"}`;
}

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
