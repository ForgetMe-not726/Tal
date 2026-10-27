export type OutlineParseIssueKind = "malformed_annotation" | "incomplete_mapping" | "unsupported_structure";

export type OutlineParseIssue = {
  kind: OutlineParseIssueKind;
  message: string;
  sheet: string;
  cell: string;
  rawText: string;
};

export type OutlineCellLocator = {
  sheet: string;
  address: string;
  row: number;
  column: number;
};

export type OutlineAnnotationStatus = "pending" | "confirmed" | "disabled";
export type OutlineMappingAction = "COPY" | "ADAPT" | "GENERATE" | "HOLD_IN_SOURCE_ONLY";

export type OutlineAnnotation = {
  raw: string;
  kind: "change" | "legacy_source_ref";
  fields: Record<string, string>;
  status: OutlineAnnotationStatus;
  action: OutlineMappingAction | null;
  locator: OutlineCellLocator;
  errors: string[];
  legacySourceUnit?: number;
};

export type OutlineMappingProjection = {
  source: string | null;
  target: string | null;
  action: OutlineMappingAction | null;
  status: OutlineAnnotationStatus;
  scope: string;
  reason: string | null;
  note: string | null;
  locator: OutlineCellLocator;
  annotationRaw: string;
  legacySourceUnit?: number;
};

export type OutlineLessonProfile = {
  lessonNumber: number;
  lessonKey: string;
  title: string;
  targetTitle: string;
  sourceCell: OutlineCellLocator;
  sourceCellText: string;
  rawValues: Record<string, string>;
  theme: string | null;
  coreVocabulary: string | null;
  reading: string | null;
  useOfEnglish: string | null;
  readingExamType: string | null;
  grammar: string | null;
  /** 大纲原文：可能列多个剑桥题型。 */
  examSkills: string | null;
  /** 实际使用的一个题型（默认只做一个，需求方 2026-10-27 确认）。 */
  primaryExamSkill: string | null;
  listening: string | null;
  speaking: string | null;
  writing: string | null;
  annotations: OutlineAnnotation[];
  mappings: OutlineMappingProjection[];
};

export type OutlineSourceMetadata = {
  fileName: string;
  fileSize: number;
  mediaType: string;
  worksheet: string;
  outlineVersion: string;
};

export type OutlineProfile = {
  source: OutlineSourceMetadata;
  headers: string[];
  lessons: OutlineLessonProfile[];
  issues: OutlineParseIssue[];
};

export type OutlineWorkbookCell = OutlineCellLocator & {
  rawText: string;
};

export type OutlineWorkbookRow = {
  row: number;
  cells: OutlineWorkbookCell[];
};

export type ParsedOutlineWorksheet = {
  name: string;
  rows: OutlineWorkbookRow[];
};
