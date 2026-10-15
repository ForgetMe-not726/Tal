/**
 * 查询计划的**契约与校验**：纯函数，不碰模型也不碰工作区。
 *
 * 与"让模型出计划"分开（后者在 `planner.ts`），这样校验逻辑能被 node 直接单测——
 * 它决定"模型给的条件认不认"，是最不能出错的一环（认错了就会拿假条件去检索）。
 */

import type { BookType } from "@/lib/db/types";
import type { AssistantSourceKind } from "./types.ts";

const BOOK_TYPES: readonly BookType[] = ["student", "workbook", "knowledge", "vocab"];
const SOURCE_KINDS: readonly AssistantSourceKind[] = ["source", "rule", "version", "reference"];

/** 中文疑问句里的功能词：退回关键词直检时要去掉，否则"查找""包含"会变成检索词。 */
const STOPWORDS = [
  "查找", "检索", "搜索", "帮我", "请", "找一下", "找找", "看看", "哪里", "哪些", "有没有",
  "包含", "含有", "关于", "相关", "中的", "里的", "里面", "是什么", "怎么", "如何",
  "的", "了", "吗", "呢", "和", "与", "在", "是", "有", "我", "要", "把",
];

export type AssistantPlan = {
  keywords: string[];
  bookType?: BookType;
  lessonNumber?: number;
  moduleKey?: string;
  sourceKind?: AssistantSourceKind;
  /** `model` = 模型解析过；`keywords` = 退回关键词直检。 */
  source: "model" | "keywords";
  /** 界面显示的一句话（老师能看见问题被理解成了什么）。 */
  note: string;
  /** 模型给了但不认识的过滤条件——如实报出来，不静默丢。 */
  dropped: string[];
};

export type PlanContext = {
  /** 工作区里真实存在的值，用来校验模型给的过滤条件。 */
  known: {
    bookTypes?: readonly string[];
    lessonNumbers?: readonly number[];
    moduleKeys?: readonly string[];
  };
  /** AI 未配置时直接走关键词路径，不白跑一次调用。 */
  aiAvailable: boolean;
};

/** 退回关键词直检：切词、去功能词、去单字。 */
export function extractKeywords(question: string): string[] {
  const rough = question
    .replace(/[，。！？、；：""''（）《》【】,.!?;:()[\]{}]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const kept = rough.filter(
    (token) => token.length >= 2 && !STOPWORDS.includes(token.toLocaleLowerCase()),
  );
  // 中文整句没有空格时，退一步：去掉功能词后剩下的整串也当关键词
  if (kept.length === 0) {
    let rest = question;
    for (const word of STOPWORDS) rest = rest.split(word).join(" ");
    return rest.split(/\s+/u).map((token) => token.trim()).filter((token) => token.length >= 2);
  }
  return kept;
}

/** 校验模型给的过滤条件：不在工作区里的值丢掉并记下来。 */
export function validatePlan(raw: Record<string, unknown>, context: PlanContext): AssistantPlan {
  const dropped: string[] = [];
  // 去重：模型常把同义词写两遍（question / question / tags / tag），重复只会拉长查询串
  const keywords = [
    ...new Set(
      (Array.isArray(raw.keywords) ? raw.keywords : [])
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.toLocaleLowerCase()),
    ),
  ];

  const bookType = typeof raw.bookType === "string" && BOOK_TYPES.includes(raw.bookType as BookType)
    ? (raw.bookType as BookType)
    : undefined;
  if (raw.bookType && !bookType) dropped.push(`书种「${String(raw.bookType)}」`);

  const lessonNumber =
    typeof raw.lessonNumber === "number" && Number.isInteger(raw.lessonNumber) &&
    (!context.known.lessonNumbers || context.known.lessonNumbers.includes(raw.lessonNumber))
      ? raw.lessonNumber
      : undefined;
  if (raw.lessonNumber != null && lessonNumber === undefined) dropped.push(`Lesson「${String(raw.lessonNumber)}」`);

  const moduleKey =
    typeof raw.moduleKey === "string" && raw.moduleKey.trim() &&
    (!context.known.moduleKeys || context.known.moduleKeys.includes(raw.moduleKey.trim()))
      ? raw.moduleKey.trim()
      : undefined;
  if (raw.moduleKey && !moduleKey) dropped.push(`模块「${String(raw.moduleKey)}」`);

  const sourceKind =
    typeof raw.sourceKind === "string" && SOURCE_KINDS.includes(raw.sourceKind as AssistantSourceKind)
      ? (raw.sourceKind as AssistantSourceKind)
      : undefined;
  if (raw.sourceKind && !sourceKind) dropped.push(`来源类型「${String(raw.sourceKind)}」`);

  return { keywords, bookType, lessonNumber, moduleKey, sourceKind, source: "model", note: "", dropped };
}

