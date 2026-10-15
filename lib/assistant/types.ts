/**
 * 通用助手的检索契约（`docs/AI-ASSISTANT-RETRIEVAL.md` §4）。
 *
 * 这一层存在的理由就是**可替换**：后续拿到本地检索工具代码后，换掉 adapter 的实现，
 * 业务层与界面不用懂它的索引格式。所以这里只写契约，不写"我们的搜索有多聪明"。
 *
 * 三条边界（§1、§7）：
 * 1. **只读**：结果里没有"应用到教材"这种入口；
 * 2. **结果优先**：返回的是可核验的命中，不是模型写的总结（profile §7.4）；
 * 3. **分数只是排序提示**，不是正确性结论——界面不把它当依据显示。
 */

import type { BookType } from "@/lib/db/types";

/** 检索范围：全工作区，或某个项目。 */
export type AssistantScope = "workspace" | "project";

/** 命中来自哪一类资料。 */
export type AssistantSourceKind = "source" | "rule" | "version" | "reference";

export const SOURCE_KIND_LABEL: Record<AssistantSourceKind, string> = {
  source: "已确认来源",
  rule: "规则",
  version: "当前项目正文",
  reference: "参考资料",
};

/** 最小查询输入（§4 逐项对应）。 */
export type AssistantQuery = {
  /** 自然语言查询。 */
  query: string;
  scope: AssistantScope;
  /** scope = project 时必填。 */
  projectId?: string;
  /** 可选过滤。 */
  bookType?: BookType;
  lessonNumber?: number;
  moduleKey?: string;
  sourceKind?: AssistantSourceKind;
  /** 返回数量上限。 */
  limit?: number;
  /** 是否需要页图证据定位（会多读一次 OCR 结构，只在要展示原页时开）。 */
  needPageEvidence?: boolean;
};

export type AssistantBox = { left: number; top: number; width: number; height: number };

/** 最小查询结果（§4 逐项对应）。 */
export type AssistantHit = {
  kind: AssistantSourceKind;
  /** 命中文本与必要上下文。 */
  snippet: string;
  /** 来源文件稳定引用。 */
  sourceRef: string;
  /** 书名/文档名。 */
  documentName: string;
  bookType: string | null;
  lessonNumber: number | null;
  moduleKey: string | null;
  /** 0 起的页码；null 表示这条命中没有页码。 */
  pageIndex: number | null;
  /** 块 ID 与页内坐标（如可用）。 */
  blockId: string | null;
  box: AssistantBox | null;
  /** 待核对 / 已确认。 */
  status: "pending" | "confirmed";
  /** 能定位到已确认的 OCR 任务时带上，供「查看原页」。 */
  ocrJobId: string | null;
  /** **仅作排序提示**，不作正确性结论。 */
  score: number;
};

/** 无命中时要如实告诉老师"搜过什么"（§6）。 */
export type AssistantSearched = {
  scope: AssistantScope;
  projects: number;
  lessons: number;
  entries: number;
  rules: number;
  versions: number;
  references: number;
  /** 本次实际用的关键词。 */
  keywords: string[];
};

export type AssistantResult = {
  hits: AssistantHit[];
  searched: AssistantSearched;
  /** 资料缺口：没有参考资料、没装语法知识库等。 */
  gaps: string[];
};

export class AssistantError extends Error {}
