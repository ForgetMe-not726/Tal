import type {
  BookRow,
  BookType,
  Grade,
  KnowledgeEntryRow,
  LessonRow,
  LessonType,
  ModuleDefinitionRow,
  ModuleMappingRow,
  ModuleRow,
  ModuleVersionRow,
  ProjectRow,
  RuleBindingRow,
  RuleRow,
  RuleScope,
  RuleVersionRow,
  SourceModuleRow,
} from "@/lib/db/types";
import { getFileStore } from "@/lib/db/file-store";

export type SourceModuleFilter = {
  projectId?: string;
  lessonId?: string;
  bookType?: string;
  status?: SourceModuleRow["status"];
};

export type ModuleMappingFilter = {
  projectId?: string;
  sourceModuleIds?: string[];
  targetModuleId?: string;
};

export type KnowledgeEntryFilter = {
  projectId?: string;
  grade?: string;
  lessonId?: string;
  bookType?: string;
  moduleKey?: string;
  sourceModuleIds?: string[];
  layers?: KnowledgeEntryRow["layer"][];
  confirmedOnly?: boolean;
};

export type ModuleVersionFilter = {
  moduleIds?: string[];
  moduleId?: string;
};

/** 数据来源。本地个人工具只有一种：老师电脑上的本地文件工作区。 */
export type DataMode = "file";

export interface AppStore {
  readonly mode: DataMode;

  listRules(): Promise<RuleRow[]>;
  insertRule(input: Omit<RuleRow, "id" | "created_at" | "updated_at">): Promise<RuleRow>;
  updateRule(
    id: string,
    patch: Partial<Pick<RuleRow, "display_name" | "rule_type" | "is_hard" | "description" | "payload">>,
  ): Promise<RuleRow>;
  deleteRule(id: string): Promise<boolean>;
  listRuleVersions(options?: { ruleId?: string; status?: RuleVersionRow["status"] }): Promise<RuleVersionRow[]>;
  getRuleVersion(ruleId: string, versionId: string): Promise<RuleVersionRow | null>;
  getLatestRuleVersion(ruleId: string): Promise<RuleVersionRow | null>;
  insertRuleVersion(input: Omit<RuleVersionRow, "id" | "created_at" | "published_at"> & { published_at?: string | null }): Promise<RuleVersionRow>;
  updateRuleVersion(
    ruleId: string,
    versionId: string,
    patch: Partial<Pick<RuleVersionRow, "instruction" | "constraints" | "change_note" | "status" | "published_at">>,
  ): Promise<RuleVersionRow>;

  listRuleBindings(ruleId?: string): Promise<RuleBindingRow[]>;
  insertRuleBinding(input: Omit<RuleBindingRow, "id" | "created_at">): Promise<RuleBindingRow>;
  deleteRuleBinding(ruleId: string, bindingId: string): Promise<boolean>;

  listModuleDefinitions(bookType?: BookType): Promise<ModuleDefinitionRow[]>;
  insertModuleDefinition(input: Omit<ModuleDefinitionRow, "id" | "created_at" | "updated_at">): Promise<ModuleDefinitionRow>;

  listProjects(): Promise<ProjectRow[]>;
  getProjectById(id: string): Promise<ProjectRow | null>;
  getProjectByNaturalKey(name: string, grade: Grade, term: string): Promise<ProjectRow | null>;
  insertProject(input: Pick<ProjectRow, "name" | "grade" | "term">): Promise<ProjectRow>;

  listLessons(projectId: string): Promise<LessonRow[]>;
  getLessonById(id: string): Promise<LessonRow | null>;
  getLessonByNaturalKey(projectId: string, lessonNumber: number): Promise<LessonRow | null>;
  insertLesson(input: Pick<LessonRow, "project_id" | "lesson_number" | "title"> & { lesson_type?: LessonType }): Promise<LessonRow>;
  updateLesson(
    id: string,
    patch: Partial<Pick<LessonRow, "title" | "status" | "lesson_type">>,
  ): Promise<LessonRow>;

  getBook(lessonId: string, bookType: BookType): Promise<BookRow | null>;
  insertBook(input: Pick<BookRow, "lesson_id" | "book_type">): Promise<BookRow>;

  getModule(bookId: string, moduleKey: string): Promise<ModuleRow | null>;
  insertModule(input: Pick<ModuleRow, "book_id" | "module_key" | "display_name" | "sort_order">): Promise<ModuleRow>;
  listBooksByLesson(lessonId: string): Promise<BookRow[]>;
  listModulesByBookIds(bookIds: string[]): Promise<ModuleRow[]>;
  listModuleVersions(filter: ModuleVersionFilter): Promise<ModuleVersionRow[]>;
  getModuleVersion(id: string): Promise<ModuleVersionRow | null>;
  insertModuleVersion(input: Omit<ModuleVersionRow, "id" | "created_at">): Promise<ModuleVersionRow>;
  updateModuleStatus(moduleId: string, status: ModuleRow["status"]): Promise<void>;

  listSourceModules(filter: SourceModuleFilter): Promise<SourceModuleRow[]>;
  getSourceModule(id: string): Promise<SourceModuleRow | null>;
  insertSourceModule(input: Omit<SourceModuleRow, "id" | "created_at" | "updated_at">): Promise<SourceModuleRow>;
  updateSourceModule(id: string, patch: Partial<Pick<SourceModuleRow, "status" | "notes" | "payload" | "title">>): Promise<SourceModuleRow>;
  listModuleMappings(filter: ModuleMappingFilter): Promise<ModuleMappingRow[]>;
  insertModuleMapping(input: Omit<ModuleMappingRow, "id" | "created_at" | "updated_at">): Promise<ModuleMappingRow>;

  listKnowledgeEntries(filter: KnowledgeEntryFilter): Promise<KnowledgeEntryRow[]>;
  getKnowledgeEntryBySourceRef(sourceRef: string): Promise<KnowledgeEntryRow | null>;
  updateKnowledgeEntry(
    id: string,
    patch: Partial<Pick<KnowledgeEntryRow, "content" | "payload" | "title">>,
  ): Promise<KnowledgeEntryRow>;
  insertKnowledgeEntry(input: Omit<KnowledgeEntryRow, "id" | "created_at">): Promise<KnowledgeEntryRow>;
}

/**
 * 数据来源恒为本地文件工作区。
 *
 * 原先的 `mock` / `supabase` 双模式已随产品本地化一并移除：
 * - `supabase` 是远程业务库，本版不再提供（profile.md §4）；
 * - `mock` 的状态存在 `globalThis`，进程一重启就丢，反复咬人；
 *   本地文件工作区正是它的解药。
 */
export function getDataMode(): DataMode {
  return "file";
}

export function getAppStore(): AppStore {
  return getFileStore();
}

/** 保留旧名以免大面积改调用点；语义仍是"是否演示数据"。 */
export function isMockMode(): boolean {
  return false;
}

export function assertSupportedScope(scope: RuleScope): void {
  if (![
    "global",
    "project",
    "grade",
    "book",
    "module",
    "lesson",
  ].includes(scope)) {
    throw new Error(`不支持的规则作用域:${scope}`);
  }
}
