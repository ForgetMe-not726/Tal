import type { BookType, FlowUnit, Level, PlateTone } from "./types";

export const LEVELS: Level[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

export const BOOK_TYPES: BookType[] = [
  { id: "student", label: "学生用书" },
  { id: "knowledge", label: "知识清单" },
  { id: "workbook", label: "练习册" },
  { id: "vocab", label: "单词小超市" },
];

/** 色版循环：青版 → 专色 → 套准绿 → 紫版（学而思多彩油墨） */
const PLATE_TONES: PlateTone[] = ["brand", "spot", "reg", "violet"];
export function plateTone(index: number): PlateTone {
  return PLATE_TONES[index % PLATE_TONES.length];
}

/** 版号字母：A / B / C / D … */
export function plateLetter(index: number): string {
  return String.fromCharCode(65 + index);
}


// ---------------------------------------------------------------------------
// 流程单元库（主页）
// ---------------------------------------------------------------------------

export const FLOW_UNITS: FlowUnit[] = [
  {
    id: "make",
    title: "制作教材",
    desc: "配置层级与书种，按模块生成结构化教材内容",
    accent: "brand",
    href: "/workbench",
  },
  {
    id: "review",
    title: "审校教材",
    desc: "按审校规则对成稿做红笔批注与修订",
    accent: "spot",
  },
  {
    id: "retrieve",
    title: "知识库检索",
    desc: "从结构化知识库召回并引用相关素材",
    accent: "neutral",
  },
];
