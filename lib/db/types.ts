/**
 * 数据库行类型:与 supabase/migrations 一一对应。
 * 表结构以 migrations 为唯一事实源;改表必须同步改这里。
 * 对应迁移:20260902000001_curriculum / 000002_rules / 000003_knowledge_assets
 */

export type Grade = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
export type BookType = "student" | "workbook" | "knowledge" | "vocab";

export type LessonStatus =
  | "not_started"
  | "in_production"
  | "student_book_confirmed"
  | "four_books_completed"
  | "reviewing"
  | "human_review"
  | "approved"
  | "archived";

export type ModuleStatus = "draft" | "editing" | "confirmed" | "modified";

export type ModuleVersionOrigin = "ai_generated" | "teacher_edited" | "imported";

export type RuleType = "generation" | "review";

export type RuleVersionStatus = "draft" | "published" | "deprecated";

export type RuleScope =
  | "global"
  | "project"
  | "grade"
  | "book"
  | "module"
  | "lesson";

export type KnowledgeLayer =
  | "production_source"
  | "authoritative_standards"
  | "reference_materials";

export interface ProjectRow {
  id: string;
  name: string;
  grade: Grade;
  term: string;
  created_at: string;
  updated_at: string;
}

export interface LessonRow {
  id: string;
  project_id: string;
  lesson_number: number;
  title: string;
  status: LessonStatus;
  created_at: string;
  updated_at: string;
}

export interface BookRow {
  id: string;
  lesson_id: string;
  book_type: BookType;
  created_at: string;
}

export interface ModuleRow {
  id: string;
  book_id: string;
  module_key: string;
  display_name: string;
  sort_order: number;
  status: ModuleStatus;
  created_at: string;
}

export interface ModuleVersionRow {
  id: string;
  module_id: string;
  version_number: number;
  content: Record<string, unknown>;
  content_format: "editor_json" | "markdown";
  origin_kind: ModuleVersionOrigin;
  /** 来源块统计:{"copy":n,"adapt":n,"generate":n}(profile.md 十六) */
  origin_summary: { copy: number; adapt: number; generate: number };
  created_by: string;
  created_at: string;
}

export interface RuleRow {
  id: string;
  rule_key: string;
  display_name: string;
  rule_type: RuleType;
  is_hard: boolean;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface RuleVersionRow {
  id: string;
  rule_id: string;
  version_number: number;
  /** 人类可读说明(Markdown),拼入 Prompt */
  instruction: string;
  /** 机器可读约束,交 Validator 确定性执行;结构随规则而异,不锁死字段 */
  constraints: Record<string, unknown>;
  status: RuleVersionStatus;
  created_by: string;
  change_note: string;
  created_at: string;
  published_at: string | null;
}

export interface RuleBindingRow {
  id: string;
  rule_id: string;
  scope: RuleScope;
  project_id: string | null;
  grade: string | null;
  book_type: string | null;
  module_key: string | null;
  lesson_id: string | null;
  created_at: string;
}

export interface KnowledgeEntryRow {
  id: string;
  layer: KnowledgeLayer;
  entry_type: string;
  title: string;
  content: string;
  /** 结构化扩展字段:词条、CEFR 级别、交际功能等,内容形态不锁死(工程原则 1) */
  payload: Record<string, unknown>;
  project_id: string | null;
  grade: string | null;
  lesson_id: string | null;
  book_type: string | null;
  module_key: string | null;
  source_ref: string;
  created_at: string;
}

export interface AssetRow {
  id: string;
  storage_path: string;
  source_document: string;
  page: number | null;
  lesson_id: string | null;
  module_key: string | null;
  relation_to_text: string;
  created_at: string;
}
