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
    id: "recognize",
    title: "资料识别",
    desc: "识别 PDF、图片为本地来源",
    accent: "neutral",
    href: "/recognize",
  },
  {
    id: "make",
    title: "教材制作",
    desc: "按大纲与模块生成四书内容",
    accent: "brand",
    href: "/workbench",
  },
  {
    id: "review",
    title: "教材审校",
    desc: "按规则查错，人工确认后出报告",
    accent: "spot",
    href: "/review",
  },
];
