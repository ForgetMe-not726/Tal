/**
 * 上游产物 → 我们的稳定契约。**纯函数**，不碰文件系统。
 *
 * 主输入是引擎的 `_content_list.json`（v1，**不是 v2**）：它是扁平数组、块顺序即阅读顺序，
 * 而且**保留了 `header`/`footer`/`page_number` 块**——旧版教材的课号印在页眉，
 * 判课边界只能靠它（v2 按页分组、没有这几类块，因此不能用）。
 *
 * 页面尺寸与置信度来自 `_middle.json`：`page_size` 用来把 PDF 点坐标换算成百分比
 * （界面要在原页图上按比例定位），`para_blocks[].score` 是块级置信度。
 *
 * 引擎专有字段只在本文件出现，业务层只认 `OcrStructure` / `OcrBlock`。
 */

// 相对路径（不是 `@/`）：本模块是纯函数、要被 node 直接单测，用别名就 import 不了。
import { buildPagedMarkdown, type ContentListBlock } from "../knowledge/ocr-pages.ts";
import type { OcrBlock, OcrBlockType, OcrPage, OcrStructure } from "./types.ts";

/**
 * 低置信阈值（引擎块级 `score`）。
 *
 * **它是排查排序的依据，不是"这块错了"的判据。** 实测旧版知识清单 633 个块：
 * 中位 0.81、25% 位 0.65、5% 位 0.49；抽查最低的十几块，文字**全部是对的**
 * （`拓展： stainless steel 不锈钢` 这类短双语块天然得分低）——这个分数来自引擎的
 * **版面**识别，不是文字准确率。所以界面只把它当作"先看哪些"的排序/筛选，
 * 不用它给老师报警。阈值定在 0.6（约后 19%）是留一条可用的排查线索。
 */
export const LOW_CONFIDENCE = 0.6;

/**
 * `content_list.json` 的坐标空间是**归一化的 1000×1000 方框**，不是 PDF 点。
 *
 * 实测三本书、两种页面尺寸（595×841、612×824）：`content_list` 的 bbox 除以
 * `middle.json` 的 bbox 恒为 `1000/页宽` 与 `1000/页高`——即引擎把页面**非等比拉伸**
 * 到 1000×1000 再输出坐标。所以百分比就是 `bbox / 1000`，**不要**拿它去和
 * `middle.json` 的 `page_size`（PDF 点）混算——那样算出来的框会跑到页面外面去。
 */
export const NORMALIZED_PAGE_SIZE = 1000;

export type MiddleBlock = {
  type?: string;
  score?: number;
  bbox?: number[];
  lines?: Array<{ spans?: Array<{ content?: string; html?: string }> }>;
};

export type MiddleFile = {
  _backend?: string;
  _version_name?: string;
  pdf_info?: Array<{
    page_idx?: number;
    page_size?: number[];
    para_blocks?: MiddleBlock[];
  }>;
};

export type EngineMeta = {
  name: string;
  version: string | null;
  backend: string | null;
  method: string | null;
  language: string | null;
};

/** 从上游元数据读引擎信息——**不写死**，换引擎/升版本时 manifest 自动跟着变。 */
export function readEngineMeta(
  middle: MiddleFile,
  extra: { method?: string | null; language?: string | null } = {},
): EngineMeta {
  return {
    name: "MinerU",
    version: middle._version_name ?? null,
    backend: middle._backend ?? null,
    method: extra.method ?? null,
    language: extra.language ?? null,
  };
}

/**
 * 逐页信息。**必须 `Array.isArray` 守卫**：上游文件损坏时 `pdf_info` 可能是字符串，
 * `for...of` 会去遍历字符，得到一个看似正常其实全错的数组。
 */
function pages(middle: MiddleFile): NonNullable<MiddleFile["pdf_info"]> {
  return Array.isArray(middle.pdf_info) ? middle.pdf_info : [];
}

/** 每页的点尺寸（PDF 点）；缺字段给 0，不编造。 */
export function pageSizes(middle: MiddleFile): Array<[number, number]> {
  const sizes: Array<[number, number]> = [];
  for (const page of pages(middle)) {
    const [width, height] = page.page_size ?? [];
    sizes.push([typeof width === "number" ? width : 0, typeof height === "number" ? height : 0]);
  }
  return sizes;
}

/**
 * 块级置信度索引：`页:文本` → 分数。
 *
 * 为什么按文本匹配而不是按坐标：实测同一块在 `content_list.json` 与 `middle.json` 里的
 * bbox **并不相同**（两个文件的坐标口径不同），按坐标对不上；文本是可靠的。
 * 对不上就留空——**不猜**，界面只对已知低置信的块提示。
 */
export function confidenceIndex(middle: MiddleFile): Map<string, number> {
  const index = new Map<string, number>();
  const key = (page: number, text: string) => `${page}:${normalizeText(text)}`;
  for (const page of pages(middle)) {
    const pageIndex = page.page_idx ?? 0;
    for (const block of page.para_blocks ?? []) {
      if (typeof block.score !== "number") continue;
      const text = (block.lines ?? [])
        .flatMap((line) => (line.spans ?? []).map((span) => span.content ?? ""))
        .join(" ");
      if (!text.trim()) continue;
      index.set(key(pageIndex, text), block.score);
    }
  }
  return index;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").toLowerCase();
}

function toBlockType(type: string, textLevel?: number | null): OcrBlockType {
  switch (type) {
    case "text":
      // 带层级的 text 就是标题——契约里给它明确的类型，界面与导出都按标题处理。
      return typeof textLevel === "number" && textLevel >= 1 ? "title" : "text";
    case "table":
      return "table";
    case "image":
    case "chart":
      return "image";
    // 引擎把部分正文误判成 code（实测知识清单的语法例句），按正文对待。
    case "code":
      return "text";
    case "header":
      return "header";
    case "footer":
      return "footer";
    case "page_number":
      return "page_number";
    case "list":
      return "list";
    case "aside_text":
      return "aside";
    default:
      return "other";
  }
}

/** 归一化坐标 → 页面百分比（见 `NORMALIZED_PAGE_SIZE`）。 */
function boxPercent(bbox: number[] | undefined): OcrBlock["box"] {
  const [x0, y0, x1, y1] = (bbox ?? [0, 0, 0, 0]).map((value) =>
    typeof value === "number" ? value : 0,
  );
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const clamp = (value: number) => round(Math.min(1, Math.max(0, value)));
  return {
    left: clamp(x0 / NORMALIZED_PAGE_SIZE),
    top: clamp(y0 / NORMALIZED_PAGE_SIZE),
    width: clamp((x1 - x0) / NORMALIZED_PAGE_SIZE),
    height: clamp((y1 - y0) / NORMALIZED_PAGE_SIZE),
  };
}

function blockText(block: ContentListBlock): string {
  if (block.type === "code") return (block.code_body ?? block.text ?? "").trim();
  return (block.text ?? "").trim();
}

/** `images/xxx.jpg` → `assets/xxx.jpg`（工作区里用 profile §3 的目录名）。 */
export function assetRelativePath(imgPath: string | undefined): string | undefined {
  if (!imgPath) return undefined;
  const name = imgPath.split(/[/\\]/).pop();
  return name ? `assets/${name}` : undefined;
}

/**
 * 把 `content_list.json` 归一化成 `structure.json`。
 *
 * 块顺序保持不变（即阅读顺序），`order` 是它在文档中的序号。
 */
export function buildStructure(input: {
  jobId: string;
  contentList: ContentListBlock[];
  middle: MiddleFile;
}): OcrStructure {
  const sizes = pageSizes(input.middle);
  const confidence = confidenceIndex(input.middle);
  const blocks: OcrBlock[] = [];
  const lowConfidence: string[] = [];

  input.contentList.forEach((raw, order) => {
    const type = toBlockType(raw.type, raw.text_level);
    const text = blockText(raw);
    const pageIndex = typeof raw.page_idx === "number" ? raw.page_idx : 0;
    const id = `b${String(order).padStart(5, "0")}`;
    const score = confidence.get(`${pageIndex}:${normalizeText(text)}`);
    if (score != null && score < LOW_CONFIDENCE) lowConfidence.push(id);
    blocks.push({
      id,
      type,
      pageIndex,
      order,
      bbox: (raw as unknown as { bbox?: number[] }).bbox
        ? ((raw as unknown as { bbox: number[] }).bbox.slice(0, 4) as [
            number,
            number,
            number,
            number,
          ])
        : [0, 0, 0, 0],
      box: boxPercent((raw as unknown as { bbox?: number[] }).bbox),
      text,
      ...(typeof raw.text_level === "number" && raw.text_level >= 1
        ? { level: raw.text_level }
        : {}),
      ...(raw.type === "table" && raw.table_body?.trim() ? { html: raw.table_body.trim() } : {}),
      ...(assetRelativePath(raw.img_path) ? { assetPath: assetRelativePath(raw.img_path)! } : {}),
      ...(score != null ? { confidence: score } : {}),
    });
  });

  const pageIndexes = [...new Set(blocks.map((block) => block.pageIndex))].sort((a, b) => a - b);
  const maxPage = pageIndexes.length > 0 ? pageIndexes[pageIndexes.length - 1] : -1;
  const pages: OcrPage[] = [];
  for (let index = 0; index <= maxPage; index += 1) {
    const [width, height] = sizes[index] ?? [0, 0];
    pages.push({
      index,
      width,
      height,
      blockCount: blocks.filter((block) => block.pageIndex === index).length,
    });
  }

  return { jobId: input.jobId, pageCount: pages.length, pages, blocks, lowConfidence };
}

/**
 * 结构化 Markdown。
 *
 * 用 `buildPagedMarkdown`（带页码标记与课边界）而不是引擎自己输出的 `.md`——
 * 后者丢了页眉页脚，课号随之丢失，整本书会连成一片。
 */
export function buildContentMarkdown(contentList: ContentListBlock[]): string {
  return buildPagedMarkdown(contentList);
}

/**
 * 给界面与 manifest 的可读提醒（不是错误）。
 *
 * 其中「坐标超出归一化范围」是**对上游假设的守卫**：块框定位依赖
 * `NORMALIZED_PAGE_SIZE` 这个归一化空间，一旦引擎换了坐标口径，块框会整体错位——
 * 与其静默画错框，不如把话说出来。
 */
export function structureWarnings(structure: OcrStructure, raw?: ContentListBlock[]): string[] {
  const warnings: string[] = [];
  const missing = structure.pages.filter((page) => page.width <= 0 || page.height <= 0);
  if (missing.length > 0) {
    warnings.push(`${missing.length} 页缺少页面尺寸（不影响块框定位，但页面比例只能靠页图推断）`);
  }
  if (structure.lowConfidence.length > 0) {
    warnings.push(
      `${structure.lowConfidence.length} 个块的引擎版面置信度低于 ${LOW_CONFIDENCE}（不等于文字有错，可用于排查排序）`,
    );
  }
  const outOfRange = (raw ?? []).filter((block) => {
    const bbox = (block as unknown as { bbox?: number[] }).bbox;
    return (bbox ?? []).some((value) => typeof value === "number" && value > NORMALIZED_PAGE_SIZE * 1.02);
  }).length;
  if (outOfRange > 0) {
    warnings.push(
      `${outOfRange} 个块的坐标超出 ${NORMALIZED_PAGE_SIZE} 归一化范围，` +
        "说明上游换了坐标口径，块框定位可能不准，请核对后再确认",
    );
  }
  return warnings;
}
