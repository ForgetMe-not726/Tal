export type Level = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type {
  OutlineLessonProfile,
  OutlineMappingProjection,
  OutlineParseIssue,
  OutlineProfile,
} from "@/lib/outline/types";
export type {
  LegacyLessonPackage,
  LegacySectionKey,
  LegacySourceCandidate,
} from "@/lib/knowledge/legacy-markdown";
import type { LegacySectionKey } from "@/lib/knowledge/legacy-markdown";

export type BookTypeId = "student" | "knowledge" | "workbook" | "vocab";

/** 课型（与 lib/db/types 的 LessonType 一致，前端侧同名导出）。 */
export type LessonType = "regular" | "revision";

/** 工作台可导出的文件格式。 */
export type ExportFormat = "markdown" | "docx";

export type PlateTone = "brand" | "spot" | "reg" | "violet";

export interface BookType {
  id: BookTypeId;
  label: string;
}

export interface ModuleDef {
  id: string;
  label: string;
  /** 仅作为旧原型 fallback;真实生成从来源与 AI Gateway 获取。 */
  markdown: string;
  moduleKey?: string;
  /** 正文标题（不含编号）；null 表示标题并进表格首行。 */
  heading?: string | null;
  /** 是否参与整课编号。 */
  numbered?: boolean;
  /** 适用课型（来自模块目录）。 */
  lessonTypes?: LessonType[];
  /** 该模块从旧版材料取哪些栏目（规范键，来自模块目录）。 */
  sourceSections?: LegacySectionKey[];
  /**
   * 确定性生成器标识。有值表示该模块**由大纲直接算出、不调用模型、也不需要旧版来源**——
   * 两个书种的课时目标都是这一类。判断"是否只依赖大纲"必须看这个字段，
   * 不能看 `sourceSections` 是否包含 objectives：知识清单的该模块 sourceSections 是空的。
   */
  deterministic?: "objectives_table" | "objectives_lesson_page";
}

export type BlockCheck = {
  ruleKey: string;
  versionNumber: number;
  code: string;
  message: string;
  expected: unknown;
  actual: unknown;
  evidence?: string;
};

export interface ModuleVersionSummary {
  id: string;
  version_number: number;
  origin_kind: "ai_generated" | "teacher_edited" | "imported";
  created_at: string;
  content: Record<string, unknown>;
}

export interface GeneratedBlock {
  id: string;
  moduleLabel: string;
  moduleKey?: string;
  moduleId?: string;
  versionId?: string;
  savedMarkdown?: string;
  markdown: string;
  checks?: BlockCheck[];
  originSummary?: { copy: number; adapt: number; generate: number };
  sourceRefs?: string[];
  migrationPlan?: { requiresHumanReview: boolean };
  seq: number;
  bookTypeId: BookTypeId;
  tone: PlateTone;
  letter: string;
}

export interface ContentSuggestion {
  id: string;
  kind: "replace" | "insert" | "delete" | "note";
  originalText: string;
  replacementText: string;
  reason: string;
  severity: "info" | "warning" | "error";
  confidence: number | null;
}

export interface RuleFile {
  id: string;
  name: string;
  desc: string;
  content: string;
}

export interface AiDiagnosticsView {
  provider: string;
  configured: boolean;
  baseUrl: string | null;
  models: string[];
  modelsEndpoint: "available" | "unsupported" | "error" | "not_applicable";
  error?: string;
}

export interface FlowUnit {
  id: "make" | "review" | "retrieve";
  title: string;
  desc: string;
  accent: "brand" | "spot" | "neutral";
  href?: string;
}
