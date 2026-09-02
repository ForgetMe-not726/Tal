export type Level = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type BookTypeId = "student" | "knowledge" | "workbook" | "vocab";

export type PlateTone = "brand" | "spot" | "reg" | "violet";

export interface BookType {
  id: BookTypeId;
  label: string;
}

export interface ModuleDef {
  id: string;
  label: string;
  markdown: string;
}

export interface GeneratedBlock {
  id: string;
  moduleLabel: string;
  markdown: string;
  seq: number;
  bookTypeId: BookTypeId;
  tone: PlateTone;
  letter: string;
}

export interface RuleFile {
  id: string;
  name: string;
  desc: string;
  content: string;
}

export interface FlowUnit {
  id: "make" | "review" | "retrieve";
  title: string;
  desc: string;
  accent: "brand" | "spot" | "neutral";
  href?: string;
}
