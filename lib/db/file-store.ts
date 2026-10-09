/**
 * 本地文件工作区实现的 `AppStore`。
 *
 * 这是 Local-0 的核心：把原来的 Supabase / 内存实现换成**本地文件**，
 * 业务层（生成、规则解析、检索、导出）一行不改——`AppStore` 就是那条重构缝。
 *
 * 定位规则：
 * - 规则与模块目录是**工作区级**的（规则作用域含 Global，要跨项目且随包分发）；
 * - 项目 / 课时 / 书 / 模块 / 版本按 profile 的目录树落在 `projects/<id>/` 下；
 * - `knowledge_entries` 按分层分家：`production_source` 随课时放 `sources.json`，
 *   参考资料（剑桥等）放工作区级 `knowledge/entries.json`——它们不属于任何一课。
 *
 * 写入一律走 `writeJson`（原子）与 `updateJson`（加锁读-改-写）。
 *
 * 性能取向：按目录扫描而不是维护全局索引。本地工具的数据量是几十课、几百个版本，
 * 扫描成本可忽略；换来的是**没有需要同步的隐藏索引**——文件就是事实。
 */

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppStore,
  KnowledgeEntryFilter,
  ModuleMappingFilter,
  ModuleVersionFilter,
  SourceModuleFilter,
} from "@/lib/db/store";
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
  RuleVersionRow,
  SourceModuleRow,
} from "@/lib/db/types";
import { ensureWorkspace } from "../workspace/bootstrap.ts";
import {
  ensureDir,
  listDir,
  readJson,
  readJsonDir,
  readJsonFromSubdirs,
  removeFile,
  updateJson,
  writeJson,
} from "../workspace/json.ts";
import {
  BOOK_FILE,
  KNOWLEDGE_ENTRIES_FILE,
  LESSON_FILE,
  LESSON_SOURCES_FILE,
  LESSONS_DIR,
  MODULE_FILE,
  PROJECT_FILE,
  RULE_BINDINGS_FILE,
  RULE_FILE,
  VERSIONS_DIR,
  knowledgeDir,
  lessonDir,
  moduleDefinitionsPath,
  projectDir,
  projectFile,
  projectsDir,
  ruleSetDir,
  rulesDir,
  safeSegment,
} from "../workspace/paths.ts";

export class FileStoreError extends Error {}

type LessonSources = {
  sourceModules: SourceModuleRow[];
  knowledgeEntries: KnowledgeEntryRow[];
  mappings: ModuleMappingRow[];
};

const EMPTY_LESSON_SOURCES: LessonSources = { sourceModules: [], knowledgeEntries: [], mappings: [] };
type KnowledgeFile = { entries: KnowledgeEntryRow[] };

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return randomUUID();
}

/** 深拷贝：调用方拿到的对象不该被后续写入影响（与原先内存实现的语义一致）。 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FileStore implements AppStore {
  readonly mode = "file" as const;

  // -------------------------------------------------------------------------
  // 规则（工作区级）
  // -------------------------------------------------------------------------

  async listRules(): Promise<RuleRow[]> {
    await ensureWorkspace();
    const rows = await this.readRuleDirs((dir) => readJson<RuleRow | null>(join(dir, RULE_FILE), null));
    return clone(
      rows
        .filter((row): row is RuleRow => row !== null)
        .map(withRulePayload)
        .sort((a, b) => a.rule_key.localeCompare(b.rule_key)),
    );
  }

  async insertRule(input: Omit<RuleRow, "id" | "created_at" | "updated_at">): Promise<RuleRow> {
    await ensureWorkspace();
    const dir = ruleSetDir(input.rule_key);
    if (await readJson<RuleRow | null>(join(dir, RULE_FILE), null)) {
      throw new FileStoreError(`规则 ${input.rule_key} 已存在`);
    }
    const timestamp = now();
    const row: RuleRow = { ...input, id: id(), created_at: timestamp, updated_at: timestamp };
    await writeJson(join(dir, RULE_FILE), row);
    return clone(row);
  }

  async updateRule(
    ruleId: string,
    patch: Partial<Pick<RuleRow, "display_name" | "rule_type" | "is_hard" | "description" | "payload">>,
  ): Promise<RuleRow> {
    const found = await this.findRule(ruleId);
    if (!found) throw new FileStoreError("规则不存在");
    return clone(
      await updateJson<RuleRow>(join(found.dir, RULE_FILE), found.row, (current) => ({
        ...current,
        ...patch,
        updated_at: now(),
      })),
    );
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const found = await this.findRule(ruleId);
    if (!found) return false;
    await rm(found.dir, { recursive: true, force: true });
    return true;
  }

  async listRuleVersions(
    options?: { ruleId?: string; status?: RuleVersionRow["status"] },
  ): Promise<RuleVersionRow[]> {
    await ensureWorkspace();
    const rows = await this.readRuleDirs((dir) => readJsonDir<RuleVersionRow>(join(dir, VERSIONS_DIR)));
    const flat = rows.flat();
    return clone(
      flat
        .filter((row) => !options?.ruleId || row.rule_id === options.ruleId)
        .filter((row) => !options?.status || row.status === options.status)
        .sort((a, b) => b.version_number - a.version_number),
    );
  }

  async getRuleVersion(ruleId: string, versionId: string): Promise<RuleVersionRow | null> {
    const versions = await this.listRuleVersions({ ruleId });
    return versions.find((row) => row.id === versionId) ?? null;
  }

  async getLatestRuleVersion(ruleId: string): Promise<RuleVersionRow | null> {
    // listRuleVersions 已按版本号倒序，第一条就是最新。
    return (await this.listRuleVersions({ ruleId }))[0] ?? null;
  }

  async insertRuleVersion(
    input: Omit<RuleVersionRow, "id" | "created_at" | "published_at"> & { published_at?: string | null },
  ): Promise<RuleVersionRow> {
    const found = await this.findRule(input.rule_id);
    if (!found) throw new FileStoreError("规则不存在，无法写入版本");
    const row: RuleVersionRow = {
      ...input,
      id: id(),
      published_at: input.published_at ?? null,
      created_at: now(),
    };
    await writeJson(join(found.dir, VERSIONS_DIR, `${row.version_number}.json`), row);
    return clone(row);
  }

  async updateRuleVersion(
    ruleId: string,
    versionId: string,
    patch: Partial<
      Pick<RuleVersionRow, "instruction" | "constraints" | "change_note" | "status" | "published_at">
    >,
  ): Promise<RuleVersionRow> {
    const found = await this.findRule(ruleId);
    if (!found) throw new FileStoreError("规则不存在");
    const target = (await this.listRuleVersions({ ruleId })).find((row) => row.id === versionId);
    if (!target) throw new FileStoreError("规则版本不存在");
    const path = join(found.dir, VERSIONS_DIR, `${target.version_number}.json`);
    return clone(await updateJson<RuleVersionRow>(path, target, (current) => ({ ...current, ...patch })));
  }

  async listRuleBindings(ruleId?: string): Promise<RuleBindingRow[]> {
    await ensureWorkspace();
    const groups = await this.readRuleDirs((dir) =>
      readJson<RuleBindingRow[]>(join(dir, RULE_BINDINGS_FILE), []),
    );
    return clone(groups.flat().filter((row) => !ruleId || row.rule_id === ruleId));
  }

  async insertRuleBinding(input: Omit<RuleBindingRow, "id" | "created_at">): Promise<RuleBindingRow> {
    const found = await this.findRule(input.rule_id);
    if (!found) throw new FileStoreError("规则不存在，无法建立绑定");
    const row: RuleBindingRow = { ...input, id: id(), created_at: now() };
    await updateJson<RuleBindingRow[]>(join(found.dir, RULE_BINDINGS_FILE), [], (current) => [...current, row]);
    return clone(row);
  }

  async deleteRuleBinding(ruleId: string, bindingId: string): Promise<boolean> {
    const found = await this.findRule(ruleId);
    if (!found) return false;
    let removed = false;
    await updateJson<RuleBindingRow[]>(join(found.dir, RULE_BINDINGS_FILE), [], (current) => {
      const next = current.filter((row) => row.id !== bindingId);
      removed = next.length !== current.length;
      return next;
    });
    return removed;
  }

  private async ruleDirNames(): Promise<string[]> {
    await ensureWorkspace();
    return listDir(rulesDir());
  }

  private async readRuleDirs<T>(read: (dir: string) => Promise<T>): Promise<T[]> {
    const values: T[] = [];
    for (const name of await this.ruleDirNames()) values.push(await read(join(rulesDir(), name)));
    return values;
  }

  private async findRule(ruleId: string): Promise<{ row: RuleRow; dir: string } | null> {
    for (const name of await this.ruleDirNames()) {
      const dir = join(rulesDir(), name);
      const row = await readJson<RuleRow | null>(join(dir, RULE_FILE), null);
      if (row?.id === ruleId) return { row: withRulePayload(row), dir };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 模块目录（工作区级）
  // -------------------------------------------------------------------------

  async listModuleDefinitions(bookType?: BookType): Promise<ModuleDefinitionRow[]> {
    await ensureWorkspace();
    const rows = await readJson<ModuleDefinitionRow[]>(moduleDefinitionsPath(), []);
    return clone(
      rows
        .filter((row) => !bookType || row.book_type === bookType)
        .sort((a, b) => a.sort_order - b.sort_order || a.module_key.localeCompare(b.module_key)),
    );
  }

  async insertModuleDefinition(
    input: Omit<ModuleDefinitionRow, "id" | "created_at" | "updated_at">,
  ): Promise<ModuleDefinitionRow> {
    await ensureWorkspace();
    const timestamp = now();
    const row: ModuleDefinitionRow = { ...input, id: id(), created_at: timestamp, updated_at: timestamp };
    await updateJson<ModuleDefinitionRow[]>(moduleDefinitionsPath(), [], (current) => {
      if (current.some((item) => item.book_type === row.book_type && item.module_key === row.module_key)) {
        throw new FileStoreError("该书种已有相同模块标识");
      }
      return [...current, row];
    });
    return clone(row);
  }

  // -------------------------------------------------------------------------
  // 项目 / 课时
  // -------------------------------------------------------------------------

  async listProjects(): Promise<ProjectRow[]> {
    await ensureWorkspace();
    const rows = await readJsonFromSubdirs<ProjectRow>(projectsDir(), PROJECT_FILE);
    // 新建的排在前面——老师刚建的项目应当先看到
    return clone(rows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  async getProjectById(projectId: string): Promise<ProjectRow | null> {
    await ensureWorkspace();
    return clone(await readJson<ProjectRow | null>(projectFile(projectId), null));
  }

  async getProjectByNaturalKey(name: string, grade: Grade, term: string): Promise<ProjectRow | null> {
    const rows = await readJsonFromSubdirs<ProjectRow>(projectsDir(), PROJECT_FILE);
    return clone(rows.find((row) => row.name === name && row.grade === grade && row.term === term) ?? null);
  }

  async insertProject(input: Pick<ProjectRow, "name" | "grade" | "term">): Promise<ProjectRow> {
    const existing = await this.getProjectByNaturalKey(input.name, input.grade, input.term);
    if (existing) return existing;
    const timestamp = now();
    const row: ProjectRow = { ...input, id: id(), created_at: timestamp, updated_at: timestamp };
    await writeJson(projectFile(row.id), row);
    return clone(row);
  }

  async listLessons(projectId: string): Promise<LessonRow[]> {
    await ensureWorkspace();
    const rows = await readJsonFromSubdirs<LessonRow>(join(projectDir(projectId), LESSONS_DIR), LESSON_FILE);
    return clone(rows.sort((a, b) => a.lesson_number - b.lesson_number));
  }

  async getLessonById(lessonId: string): Promise<LessonRow | null> {
    const found = await this.findLesson(lessonId);
    return found ? clone(found.row) : null;
  }

  async getLessonByNaturalKey(projectId: string, lessonNumber: number): Promise<LessonRow | null> {
    await ensureWorkspace();
    return clone(
      await readJson<LessonRow | null>(join(lessonDir(projectId, lessonNumber), LESSON_FILE), null),
    );
  }

  async insertLesson(
    input: Pick<LessonRow, "project_id" | "lesson_number" | "title"> & { lesson_type?: LessonType },
  ): Promise<LessonRow> {
    const existing = await this.getLessonByNaturalKey(input.project_id, input.lesson_number);
    if (existing) return existing;
    const timestamp = now();
    const row: LessonRow = {
      ...input,
      id: id(),
      status: "not_started",
      lesson_type: input.lesson_type ?? "regular",
      created_at: timestamp,
      updated_at: timestamp,
    };
    await writeJson(join(lessonDir(row.project_id, row.lesson_number), LESSON_FILE), row);
    return clone(row);
  }

  async updateLesson(
    lessonId: string,
    patch: Partial<Pick<LessonRow, "title" | "status" | "lesson_type">>,
  ): Promise<LessonRow> {
    const found = await this.findLesson(lessonId);
    if (!found) throw new FileStoreError("Lesson 不存在");
    return clone(
      await updateJson<LessonRow>(join(found.dir, LESSON_FILE), found.row, (current) => ({
        ...current,
        ...patch,
        updated_at: now(),
      })),
    );
  }

  /** 遍历所有项目的所有课时。返回 row 与它所在目录。 */
  private async scanLessons(): Promise<Array<{ row: LessonRow; dir: string }>> {
    await ensureWorkspace();
    const result: Array<{ row: LessonRow; dir: string }> = [];
    for (const projectName of await listDir(projectsDir())) {
      const lessonsPath = join(projectsDir(), projectName, "lessons");
      for (const lessonName of await listDir(lessonsPath)) {
        const dir = join(lessonsPath, lessonName);
        const row = await readJson<LessonRow | null>(join(dir, LESSON_FILE), null);
        if (row) result.push({ row, dir });
      }
    }
    return result;
  }

  private async findLesson(lessonId: string): Promise<{ row: LessonRow; dir: string } | null> {
    return (await this.scanLessons()).find((item) => item.row.id === lessonId) ?? null;
  }

  // -------------------------------------------------------------------------
  // 书 / 模块 / 版本
  // -------------------------------------------------------------------------

  async getBook(lessonId: string, bookType: BookType): Promise<BookRow | null> {
    const lesson = await this.findLesson(lessonId);
    if (!lesson) return null;
    return clone(
      await readJson<BookRow | null>(join(lesson.dir, "books", safeSegment(bookType), BOOK_FILE), null),
    );
  }

  async insertBook(input: Pick<BookRow, "lesson_id" | "book_type">): Promise<BookRow> {
    const existing = await this.getBook(input.lesson_id, input.book_type);
    if (existing) return existing;
    const lesson = await this.findLesson(input.lesson_id);
    if (!lesson) throw new FileStoreError("Lesson 不存在，无法建书");
    const row: BookRow = { ...input, id: id(), created_at: now() };
    await writeJson(join(lesson.dir, "books", safeSegment(input.book_type), BOOK_FILE), row);
    return clone(row);
  }

  async getModule(bookId: string, moduleKey: string): Promise<ModuleRow | null> {
    const book = (await this.scanBooks()).find((item) => item.row.id === bookId);
    if (!book) return null;
    return clone(await readJson<ModuleRow | null>(join(book.dir, safeSegment(moduleKey), MODULE_FILE), null));
  }

  async insertModule(
    input: Pick<ModuleRow, "book_id" | "module_key" | "display_name" | "sort_order">,
  ): Promise<ModuleRow> {
    const existing = await this.getModule(input.book_id, input.module_key);
    if (existing) return existing;
    const book = (await this.scanBooks()).find((item) => item.row.id === input.book_id);
    if (!book) throw new FileStoreError("书不存在，无法建模块");
    const row: ModuleRow = { ...input, id: id(), status: "draft", created_at: now() };
    await writeJson(join(book.dir, safeSegment(input.module_key), MODULE_FILE), row);
    return clone(row);
  }

  async listBooksByLesson(lessonId: string): Promise<BookRow[]> {
    const lesson = await this.findLesson(lessonId);
    if (!lesson) return [];
    return clone(await readJsonFromSubdirs<BookRow>(join(lesson.dir, "books"), BOOK_FILE));
  }

  async listModulesByBookIds(bookIds: string[]): Promise<ModuleRow[]> {
    if (bookIds.length === 0) return [];
    const wanted = new Set(bookIds);
    const rows: ModuleRow[] = [];
    for (const book of await this.scanBooks()) {
      if (!wanted.has(book.row.id)) continue;
      rows.push(...(await readJsonFromSubdirs<ModuleRow>(book.dir, MODULE_FILE)));
    }
    return clone(rows);
  }

  async listModuleVersions(filter: ModuleVersionFilter): Promise<ModuleVersionRow[]> {
    const wanted = new Set(filter.moduleId ? [filter.moduleId] : (filter.moduleIds ?? []));
    const rows: ModuleVersionRow[] = [];
    for (const item of await this.scanModules()) {
      if (wanted.size > 0 && !wanted.has(item.row.id)) continue;
      rows.push(...(await readJsonDir<ModuleVersionRow>(join(item.dir, VERSIONS_DIR))));
    }
    return clone(rows.sort((a, b) => b.version_number - a.version_number));
  }

  async getModuleVersion(versionId: string): Promise<ModuleVersionRow | null> {
    for (const item of await this.scanModules()) {
      const rows = await readJsonDir<ModuleVersionRow>(join(item.dir, VERSIONS_DIR));
      const found = rows.find((row) => row.id === versionId);
      if (found) return clone(found);
    }
    return null;
  }

  async insertModuleVersion(input: Omit<ModuleVersionRow, "id" | "created_at">): Promise<ModuleVersionRow> {
    const target = (await this.scanModules()).find((item) => item.row.id === input.module_id);
    if (!target) throw new FileStoreError("模块不存在，无法写入版本");
    const row: ModuleVersionRow = { ...input, id: id(), created_at: now() };
    await writeJson(join(target.dir, VERSIONS_DIR, `${row.version_number}.json`), row);
    return clone(row);
  }

  async updateModuleStatus(moduleId: string, status: ModuleRow["status"]): Promise<void> {
    const target = (await this.scanModules()).find((item) => item.row.id === moduleId);
    if (!target) throw new FileStoreError("模块不存在");
    await updateJson<ModuleRow>(join(target.dir, MODULE_FILE), target.row, (current) => ({
      ...current,
      status,
    }));
  }

  private async scanBooks(): Promise<Array<{ row: BookRow; dir: string }>> {
    const result: Array<{ row: BookRow; dir: string }> = [];
    for (const lesson of await this.scanLessons()) {
      const booksPath = join(lesson.dir, "books");
      for (const name of await listDir(booksPath)) {
        const dir = join(booksPath, name);
        const row = await readJson<BookRow | null>(join(dir, BOOK_FILE), null);
        if (row) result.push({ row, dir });
      }
    }
    return result;
  }

  private async scanModules(): Promise<Array<{ row: ModuleRow; dir: string }>> {
    const result: Array<{ row: ModuleRow; dir: string }> = [];
    for (const book of await this.scanBooks()) {
      for (const name of await listDir(book.dir)) {
        const dir = join(book.dir, name);
        const row = await readJson<ModuleRow | null>(join(dir, MODULE_FILE), null);
        if (row) result.push({ row, dir });
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 来源 / 映射 / 知识条目
  // -------------------------------------------------------------------------

  async listSourceModules(filter: SourceModuleFilter): Promise<SourceModuleRow[]> {
    const rows = (await this.readAllLessonSources()).flatMap((item) => item.sourceModules);
    return clone(
      rows
        .filter((row) => !filter.projectId || row.project_id === filter.projectId)
        .filter((row) => !filter.lessonId || row.lesson_id === filter.lessonId)
        .filter((row) => !filter.bookType || row.book_type === filter.bookType)
        .filter((row) => !filter.status || row.status === filter.status)
        .sort((a, b) => a.sort_order - b.sort_order),
    );
  }

  async getSourceModule(sourceModuleId: string): Promise<SourceModuleRow | null> {
    const rows = (await this.readAllLessonSources()).flatMap((item) => item.sourceModules);
    return clone(rows.find((row) => row.id === sourceModuleId) ?? null);
  }

  async insertSourceModule(
    input: Omit<SourceModuleRow, "id" | "created_at" | "updated_at">,
  ): Promise<SourceModuleRow> {
    const timestamp = now();
    const row: SourceModuleRow = { ...input, id: id(), created_at: timestamp, updated_at: timestamp };
    await this.updateLessonSources(row.project_id, row.lesson_id, (current) => ({
      ...current,
      sourceModules: [...current.sourceModules, row],
    }));
    return clone(row);
  }

  async updateSourceModule(
    sourceModuleId: string,
    patch: Partial<Pick<SourceModuleRow, "status" | "notes" | "payload" | "title">>,
  ): Promise<SourceModuleRow> {
    const found = await this.getSourceModule(sourceModuleId);
    if (!found) throw new FileStoreError("来源模块不存在");
    let updated: SourceModuleRow | null = null;
    await this.updateLessonSources(found.project_id, found.lesson_id, (current) => ({
      ...current,
      sourceModules: current.sourceModules.map((row) => {
        if (row.id !== sourceModuleId) return row;
        updated = { ...row, ...patch, updated_at: now() };
        return updated;
      }),
    }));
    if (!updated) throw new FileStoreError("来源模块不存在");
    return clone(updated);
  }

  async listModuleMappings(filter: ModuleMappingFilter): Promise<ModuleMappingRow[]> {
    const rows = (await this.readAllLessonSources()).flatMap((item) => item.mappings);
    return clone(
      rows
        .filter((row) => !filter.projectId || row.project_id === filter.projectId)
        .filter((row) => !filter.targetModuleId || row.target_module_id === filter.targetModuleId)
        .filter(
          (row) => !filter.sourceModuleIds?.length || filter.sourceModuleIds.includes(row.source_module_id),
        ),
    );
  }

  async insertModuleMapping(
    input: Omit<ModuleMappingRow, "id" | "created_at" | "updated_at">,
  ): Promise<ModuleMappingRow> {
    const source = await this.getSourceModule(input.source_module_id);
    if (!source) throw new FileStoreError("来源模块不存在，无法建立映射");
    const timestamp = now();
    const row: ModuleMappingRow = { ...input, id: id(), created_at: timestamp, updated_at: timestamp };
    await this.updateLessonSources(source.project_id, source.lesson_id, (current) => ({
      ...current,
      mappings: [...current.mappings, row],
    }));
    return clone(row);
  }

  async listKnowledgeEntries(filter: KnowledgeEntryFilter): Promise<KnowledgeEntryRow[]> {
    // 空数组过滤条件表示"限定为空集"，与原先 Supabase 实现一致（返回空而不是全量）。
    if (filter.sourceModuleIds?.length === 0) return [];
    if (filter.layers?.length === 0) return [];

    const lessonRows = (await this.readAllLessonSources()).flatMap((item) => item.knowledgeEntries);
    const workspaceRows = await this.readWorkspaceKnowledge();

    return clone(
      [...lessonRows, ...workspaceRows]
        .filter((row) => !filter.projectId || row.project_id === filter.projectId)
        .filter((row) => !filter.grade || row.grade === filter.grade)
        .filter((row) => !filter.lessonId || row.lesson_id === filter.lessonId)
        .filter((row) => !filter.bookType || row.book_type === filter.bookType)
        .filter((row) => !filter.moduleKey || row.module_key === filter.moduleKey)
        .filter((row) => !filter.layers || filter.layers.includes(row.layer))
        .filter(
          (row) =>
            !filter.sourceModuleIds || filter.sourceModuleIds.includes(row.source_module_id ?? ""),
        )
        .filter((row) => !filter.confirmedOnly || isConfirmed(row))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  async getKnowledgeEntryBySourceRef(sourceRef: string): Promise<KnowledgeEntryRow | null> {
    const lessonRows = (await this.readAllLessonSources()).flatMap((item) => item.knowledgeEntries);
    const workspaceRows = await this.readWorkspaceKnowledge();
    return clone([...lessonRows, ...workspaceRows].find((row) => row.source_ref === sourceRef) ?? null);
  }

  async updateKnowledgeEntry(
    entryId: string,
    patch: Partial<Pick<KnowledgeEntryRow, "content" | "payload" | "title">>,
  ): Promise<KnowledgeEntryRow> {
    for (const sources of await this.readAllLessonSources()) {
      const target = sources.knowledgeEntries.find((row) => row.id === entryId);
      if (!target || !isLessonScoped(target)) continue;
      let updated: KnowledgeEntryRow | null = null;
      await this.updateLessonSources(target.project_id, target.lesson_id, (current) => ({
        ...current,
        knowledgeEntries: current.knowledgeEntries.map((row) => {
          if (row.id !== entryId) return row;
          updated = { ...row, ...patch };
          return updated;
        }),
      }));
      if (updated) return clone(updated);
    }

    let updated: KnowledgeEntryRow | null = null;
    await updateJson<KnowledgeFile>(this.workspaceKnowledgePath(), { entries: [] }, (current) => ({
      entries: current.entries.map((row) => {
        if (row.id !== entryId) return row;
        updated = { ...row, ...patch };
        return updated;
      }),
    }));
    if (!updated) throw new FileStoreError("知识条目不存在");
    return clone(updated);
  }

  async insertKnowledgeEntry(input: Omit<KnowledgeEntryRow, "id" | "created_at">): Promise<KnowledgeEntryRow> {
    const row: KnowledgeEntryRow = { ...input, id: id(), created_at: now() };
    // 生产来源随课时走；没有课时的（剑桥、教辅等参考资料）是工作区级的。
    if (isLessonScoped(row)) {
      await this.updateLessonSources(row.project_id, row.lesson_id, (current) => ({
        ...current,
        knowledgeEntries: [...current.knowledgeEntries, row],
      }));
    } else {
      await updateJson<KnowledgeFile>(this.workspaceKnowledgePath(), { entries: [] }, (current) => ({
        entries: [...current.entries, row],
      }));
    }
    return clone(row);
  }

  private workspaceKnowledgePath(): string {
    return join(knowledgeDir(), KNOWLEDGE_ENTRIES_FILE);
  }

  private async readWorkspaceKnowledge(): Promise<KnowledgeEntryRow[]> {
    await ensureWorkspace();
    return (await readJson<KnowledgeFile>(this.workspaceKnowledgePath(), { entries: [] })).entries;
  }

  /**
   * 课时级来源清单的落点。
   *
   * `lessonId` 是 UUID，不能直接当目录名——先查出这个课时，用它的编号定位。
   * `lesson_id` 为空的来源挂到项目级文件（例如整册扫描件不属于任何一课）。
   */
  private async sourcesPath(projectId: string, lessonId: string | null): Promise<string> {
    if (lessonId) {
      const lesson = await this.findLesson(lessonId);
      if (lesson) return join(lesson.dir, LESSON_SOURCES_FILE);
    }
    return join(projectDir(projectId), LESSON_SOURCES_FILE);
  }

  private async updateLessonSources(
    projectId: string,
    lessonId: string | null,
    mutate: (current: LessonSources) => LessonSources,
  ): Promise<LessonSources> {
    await ensureWorkspace();
    const path = await this.sourcesPath(projectId, lessonId);
    await ensureDir(dirname(path));
    return updateJson<LessonSources>(path, EMPTY_LESSON_SOURCES, mutate);
  }

  private async readAllLessonSources(): Promise<LessonSources[]> {
    await ensureWorkspace();
    const result: LessonSources[] = [];
    for (const projectName of await listDir(projectsDir())) {
      const projectPath = join(projectsDir(), projectName);
      result.push(
        await readJson<LessonSources>(join(projectPath, LESSON_SOURCES_FILE), EMPTY_LESSON_SOURCES),
      );
      const lessonsPath = join(projectPath, "lessons");
      for (const lessonName of await listDir(lessonsPath)) {
        result.push(
          await readJson<LessonSources>(
            join(lessonsPath, lessonName, LESSON_SOURCES_FILE),
            EMPTY_LESSON_SOURCES,
          ),
        );
      }
    }
    return result;
  }
}

/**
 * 条目是否算"已确认"。
 *
 * 生产来源必须显式 confirmed（未经确认的 OCR 只是候选，不能进入正式生成）；
 * 其他分层排除 pending 即可。
 */
/**
 * 早期写入的 `rule.json` 没有 `payload` 字段（规则元数据是后加的）。
 * 读的时候补空对象，让下游不必到处判 undefined——文件不用改写，向后兼容。
 */
function withRulePayload(row: RuleRow): RuleRow {
  return row.payload ? row : { ...row, payload: {} };
}

function isConfirmed(row: KnowledgeEntryRow): boolean {
  const status = row.payload.source_status;
  return row.layer === "production_source" ? status === "confirmed" : status !== "pending";
}

/**
 * 是否属于某一课。
 *
 * 两个字段都可能为空：参考资料（剑桥、教辅）不属于任何项目或课时，
 * 存工作区级的 `knowledge/entries.json`；只有两者都齐的才是课时级生产来源。
 */
function isLessonScoped(row: KnowledgeEntryRow): row is KnowledgeEntryRow & {
  project_id: string;
  lesson_id: string;
} {
  return Boolean(row.project_id && row.lesson_id);
}

let fileStore: FileStore | null = null;

export function getFileStore(): AppStore {
  fileStore ??= new FileStore();
  return fileStore;
}

export function resetFileStoreForTests(): void {
  fileStore = null;
}

export { removeFile };
