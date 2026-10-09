/**
 * 领域行类型。
 *
 * 字段沿用原先数据库表的形状，但**不再对应任何远程数据库**——
 * 本工具是本地个人工具，这些行由 `lib/db/file-store.ts` 读写工作区里的 JSON 文件
 * （profile.md §3 的目录契约）。保留原字段名是为了让业务层不必改动。
 * 表结构以 migrations 为唯一事实源;改表必须同步改这里。
 * 对应迁移:20260902000001_curriculum / 000002_rules / 000003_knowledge_assets /
 * 000004_rule_engine_hardening / 000005_module_mapping
 */

export type Grade = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
export type BookType = "student" | "workbook" | "knowledge" | "vocab";

/**
 * 课型。学生用书常规课 5 个模块、复习课 3 个；知识清单两种课型结构相同。
 * 由老师按大纲选择，不从标题推断（复习课的判定依据尚未确认）。
 */
export type LessonType = "regular" | "revision";

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

/** 旧教材加工的最小人工确认状态;完整状态机留给 Phase 1。 */
export type SourceModuleStatus = "pending" | "confirmed";

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
  lesson_type: LessonType;
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

export interface ModuleDefinitionRow {
  id: string;
  book_type: BookType;
  module_key: string;
  display_name: string;
  sort_order: number;
  description: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SourceModuleRow {
  id: string;
  project_id: string;
  lesson_id: string | null;
  /** 数据库暂留开放文本,方便 Phase 1 处理非四书来源。 */
  book_type: string;
  title: string;
  sort_order: number;
  status: SourceModuleStatus;
  source_document: string;
  page: number | null;
  notes: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ModuleMappingRow {
  id: string;
  project_id: string;
  source_module_id: string;
  /** 指向 canonical module_definitions,不是 modules 实例。 */
  target_module_id: string;
  /** DB 保持开放文本;基数由多行关系表达。 */
  mapping_type: string;
  /** 数值越小越优先。 */
  priority: number;
  notes: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RuleRow {
  id: string;
  rule_key: string;
  display_name: string;
  rule_type: RuleType;
  is_hard: boolean;
  description: string;
  /**
   * 规则元数据（阶段、执行方式、源行映射、判据引用等）。
   *
   * 与 `ModuleDefinitionRow.payload` 同一套做法：机器约束在 `constraints` 里，
   * 这里放**描述性元数据**。工作区里 `rule.json` 是 JSON blob，加字段向后兼容。
   */
  payload: Record<string, unknown>;
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
  /** 严格 provenance 链;软检索仍使用 source_ref/module_key/book_type。 */
  source_module_id: string | null;
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
  source_module_id: string | null;
  relation_to_text: string;
  created_at: string;
}
