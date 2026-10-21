/**
 * 资料识别的稳定契约。
 *
 * 上游是 OCR 引擎（默认 MinerU，见 `docs/OCR-ENGINE-DECISION.md`），下游是教材制作与检索。
 * **业务层只认这里的类型和磁盘上的那几个文件**，不认任何引擎的专有格式——
 * 换引擎只换 adapter，不动业务。
 */

import type { BookType } from "@/lib/db/types";

/**
 * 任务状态。界面按 `PRODUCT.md` §5 的教研语言显示：
 * 待识别 / 识别中 / 待核对 / 已确认来源 / 失败。
 */
export type OcrJobStatus =
  /** 已建任务，还没开跑 */
  | "queued"
  /** 引擎在跑 */
  | "running"
  /** 引擎跑完，正在归一化产物（结构 JSON、Markdown、页图） */
  | "normalizing"
  /** 产物齐了，等老师核对——**此时还不能用于生成** */
  | "ready"
  /** 老师确认，进入 Production Source 候选 */
  | "confirmed"
  /** 失败，`message` 给可读原因 */
  | "failed"
  /** 老师取消 */
  | "cancelled"
  /** 服务重启等原因中断，可重新识别 */
  | "interrupted";

/** 块类型，对应 `docs/OCR-ENGINE-DECISION.md` 的稳定契约。 */
export type OcrBlockType =
  | "title"
  | "text"
  | "table"
  | "image"
  | "list"
  | "header"
  | "footer"
  | "page_number"
  | "code"
  | "chart"
  | "aside"
  | "other";

/**
 * 一个内容块。
 *
 * `bbox` 保留引擎给的原始坐标（PDF 点），同时给出**百分比**——界面在原页图上按百分比
 * 定位，不需要知道页面的点尺寸（不同书的页面尺寸不同）。
 */
export type OcrBlock = {
  id: string;
  type: OcrBlockType;
  /** 0 起，与引擎的 `page_idx` 一致。 */
  pageIndex: number;
  /** 阅读顺序：块在文档中的序号，从 0 起。 */
  order: number;
  /** 原始坐标 `[x0, y0, x1, y1]`，PDF 点。 */
  bbox: [number, number, number, number];
  /** 相对页面的百分比坐标，便于界面直接套用。 */
  box: { left: number; top: number; width: number; height: number };
  text: string;
  /** 标题层级（引擎给 `text_level` 时）。 */
  level?: number;
  /** 表格的 HTML（引擎给 `table_body` 时）。 */
  html?: string;
  /** 图片资产在工作区里的相对路径（如 `assets/abc.jpg`）。 */
  assetPath?: string;
  /** 识别置信度（引擎给分时）；低于阈值的块在界面提示"低置信"。 */
  confidence?: number;
};

export type OcrPage = {
  index: number;
  width: number;
  height: number;
  blockCount: number;
};

/** `manifest.json`：一次 OCR 的完整档案。 */
export type OcrManifest = {
  jobId: string;
  projectId: string;
  bookType: BookType;
  /** 原始文件名（已复制进 `sources/originals/`）。 */
  originalName: string;
  originalBytes: number;
  status: OcrJobStatus;
  /** 引擎与版本，从上游产物的元数据里读，不写死。 */
  engine: {
    name: string;
    version: string | null;
    backend: string | null;
    method: string | null;
    language: string | null;
  };
  pageCount: number;
  /** 页图渲染参数（可重建的依据）。 */
  pages: { format: "jpeg" | "png"; dpi: number; quality?: number };
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  /** 归一化过程中的提醒（低置信块数、缺页图等），不是错误。 */
  warnings?: string[];
};

/** `.app/jobs/<id>.json`：在跑任务的状态（可重建，不是事实源）。 */
export type OcrJobRecord = {
  id: string;
  projectId: string;
  bookType: BookType;
  status: OcrJobStatus;
  /** 原文件在工作区里的绝对路径。 */
  originalPath: string;
  originalName: string;
  /** 引擎子进程 pid，用于取消与陈旧任务判定。 */
  pid?: number;
  /** 已处理页数 / 总页数；拿不到就为 null，**不编造百分比**。 */
  pagesDone?: number | null;
  pagesTotal?: number | null;
  /** 页数的来源：`pdf` = 直接读 PDF 得到的真实页数（旧记录没有这个标记）。 */
  pagesSource?: "pdf";
  /** 上游产物的落点（稳定目录）。服务重启后据此接着整理，不必整本重跑。 */
  upstreamDir?: string;
  /**
   * 创建这个任务的进程。**本进程持有的任务不做"陈旧"判定**——
   * MinerU 退出后还要整理几十秒，这期间 pid 已经死了，不能当成中断。
   */
  ownerPid?: number;
  /** 阶段说明（给老师看的一句话）。 */
  stage: string;
  message?: string;
  /** 上游日志尾部，失败时用于诊断。 */
  logTail?: string[];
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
};

/** `structure.json`：归一化后的结构，界面与检索都读它。 */
export type OcrStructure = {
  jobId: string;
  pageCount: number;
  pages: OcrPage[];
  blocks: OcrBlock[];
  /** 低置信块的 id，界面据此提示。 */
  lowConfidence: string[];
};

/** 已确认来源的摘要，供制作页下拉选择。 */
export type OcrSourceSummary = {
  jobId: string;
  projectId: string;
  bookType: BookType;
  originalName: string;
  pageCount: number;
  confirmedAt: string;
};

export class OcrError extends Error {}
