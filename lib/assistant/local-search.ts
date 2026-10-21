/**
 * 内置的本地检索实现（`RetrievalAdapter` 的默认实现）：**读工作区**那一半。
 *
 * 它做的是**字面匹配**，不是语义检索——这一点必须说清楚：`docs/AI-ASSISTANT-RETRIEVAL.md` §4
 * 要求"不虚构检索工具的具体能力和性能"。将来本地检索工具代码到位，换掉 adapter 实现即可，
 * 契约、界面与这里的语料结构都不用动。
 *
 * 四个语料（全部只读）：
 * - **知识条目**：旧版教材与参考资料的已确认结构化来源（含待核对的，按状态如实标注）；
 * - **规则**：规则名、说明与最新版本的指令正文；
 * - **当前项目正文**：各模块版本里的 Markdown；
 * - **参考资料**：工作区的语法参考知识库。
 *
 * 匹配与排序在 `match.ts`（纯函数，可单测）。
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getAppStore } from "@/lib/db/store";
import { contentToMarkdown } from "@/lib/knowledge/related-content";
import { knowledgeDir } from "@/lib/workspace/paths";
import { listCollectionModules, readCollectionChunk } from "@/lib/knowledge/collections";
import { searchCorpora, type SearchCorpora } from "./match.ts";
import type { AssistantQuery, AssistantResult } from "./types.ts";

/** 单个语料最多扫描多少字符，避免一条超长正文把检索拖住。 */
const MAX_SCAN_CHARS = 200_000;
/** 范本教材最多读多少个模块文件（集合变大后先截断，并在缺口里说明）。 */
const MAX_COLLECTION_DOCS = 300;

/**
 * 只读**校验查询计划需要的元数据**：有哪些课、哪些模块标识。
 *
 * `/api/assistant` 先用它校验模型给的过滤条件，再把真正的检索交给 adapter——
 * 否则一次请求会把整个语料读两遍（实测 route 收一次、adapter 再收一次）。
 */
export async function collectPlanContext(query: AssistantQuery): Promise<{
  lessonNumbers: number[];
  moduleKeys: string[];
}> {
  const store = getAppStore();
  const projects = await store.listProjects();
  const scoped =
    query.scope === "project" && query.projectId
      ? projects.filter((project) => project.id === query.projectId)
      : projects;
  const lessonNumbers = new Set<number>();
  const moduleKeys = new Set<string>();
  for (const project of scoped) {
    const lessons = await store.listLessons(project.id);
    for (const lesson of lessons) lessonNumbers.add(lesson.lesson_number);
    const books = (await Promise.all(lessons.map((lesson) => store.listBooksByLesson(lesson.id)))).flat();
    if (books.length === 0) continue;
    for (const entry of await store.listModulesByBookIds(books.map((book) => book.id))) {
      moduleKeys.add(entry.module_key);
    }
  }
  // 知识库集合里的模块标识同样可选
  for (const row of await listCollectionModules()) moduleKeys.add(row.module.moduleKey);
  return {
    lessonNumbers: [...lessonNumbers].sort((a, b) => a - b),
    moduleKeys: [...moduleKeys].sort(),
  };
}

/**
 * 把要搜的东西一次性读出来。
 *
 * 工作区很小（实测一个项目 7 课、58 条来源、66 个版本），直接扫比维护索引省事也更诚实；
 * 索引是 adapter 背后的事，将来随检索工具一起进来。
 */
export async function collectCorpora(query: AssistantQuery): Promise<SearchCorpora> {
  const store = getAppStore();
  const allProjects = await store.listProjects();
  const projects =
    query.scope === "project" && query.projectId
      ? allProjects.filter((project) => project.id === query.projectId)
      : allProjects;

  const lessons: SearchCorpora["lessons"] = [];
  const versions: SearchCorpora["versions"] = [];
  for (const project of projects) {
    const rows = await store.listLessons(project.id);
    for (const lesson of rows) lessons.push({ projectId: project.id, lesson });

    const books = (await Promise.all(rows.map((lesson) => store.listBooksByLesson(lesson.id)))).flat();
    if (books.length === 0) continue;
    const modules = await store.listModulesByBookIds(books.map((book) => book.id));
    if (modules.length === 0) continue;
    const bookTypeById = new Map(books.map((book) => [book.id, book.book_type]));
    const lessonIdByBook = new Map(books.map((book) => [book.id, book.lesson_id]));
    const lessonNumberById = new Map(rows.map((lesson) => [lesson.id, lesson.lesson_number]));
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    const versionRows = await store.listModuleVersions({ moduleIds: modules.map((module) => module.id) });
    // 每个模块只取**最新版本**：旧版本内容会和最新版重复出现，还可能把已废弃的稿当成当前正文
    const latestByModule = new Map();
    for (const version of versionRows) {
      const existing = latestByModule.get(version.module_id);
      if (!existing || version.version_number > existing.version_number) {
        latestByModule.set(version.module_id, version);
      }
    }
    for (const version of latestByModule.values()) {
      const moduleRow = moduleById.get(version.module_id);
      if (!moduleRow) continue;
      const markdown = contentToMarkdown(version.content).slice(0, MAX_SCAN_CHARS);
      if (!markdown.trim()) continue;
      versions.push({
        bookType: bookTypeById.get(moduleRow.book_id) ?? "unknown",
        moduleKey: moduleRow.module_key,
        moduleLabel: moduleRow.display_name,
        versionNumber: version.version_number,
        lessonNumber: lessonNumberById.get(lessonIdByBook.get(moduleRow.book_id) ?? "") ?? null,
        markdown,
      });
    }
  }

  const entries = await store.listKnowledgeEntries(
    query.scope === "project" && query.projectId ? { projectId: query.projectId } : {},
  );

  const ruleRows = await store.listRules();
  const ruleVersions = await store.listRuleVersions();
  const latestByRule = new Map<string, string>();
  for (const version of ruleVersions) {
    if (!latestByRule.has(version.rule_id)) latestByRule.set(version.rule_id, version.instruction);
  }
  const bindings = await store.listRuleBindings();
  const scopeByRule = new Map<string, string>();
  for (const binding of bindings) {
    if (!scopeByRule.has(binding.rule_id)) scopeByRule.set(binding.rule_id, binding.scope);
  }
  const rules = ruleRows.map((row) => ({
    ruleKey: row.rule_key,
    displayName: row.display_name,
    description: row.description ?? "",
    instruction: latestByRule.get(row.id) ?? "",
    scope: scopeByRule.get(row.id) ?? "global",
  }));

  const { docs: collectionDocs, total: collectionTotal } = await collectCollectionDocs();
  return {
    projects,
    lessons,
    entries,
    rules,
    versions,
    references: await collectGrammarReferences(),
    collectionDocs,
    collectionTotal,
  };
}

/** 范本教材：按 manifest 找到模块文件再读正文（带页码标记）。 */
async function collectCollectionDocs(input?: { bookType?: string; lessonNumber?: number; moduleKey?: string }) {
  const rows = await listCollectionModules({
    bookType: input?.bookType as never,
    lessonNumber: input?.lessonNumber,
    moduleKey: input?.moduleKey,
  });
  const docs: SearchCorpora["collectionDocs"] = [];
  for (const row of rows.slice(0, MAX_COLLECTION_DOCS)) {
    const chunk = await readCollectionChunk(row.manifest, row.book, row.lesson, row.module);
    if (!chunk) continue;
    docs.push({
      collectionId: chunk.collectionId,
      collectionTitle: chunk.collectionTitle,
      bookType: chunk.bookType,
      lessonNumber: chunk.lessonNumber,
      lessonTitle: chunk.lessonTitle,
      moduleKey: chunk.moduleKey,
      pages: chunk.pages,
      text: chunk.text.slice(0, MAX_SCAN_CHARS),
    });
  }
  return { docs, total: rows.length };
}

/** 语法参考知识库：按文件读进来，文件名当标题。 */
async function collectGrammarReferences(): Promise<SearchCorpora["references"]> {
  const root = join(knowledgeDir(), "grammar");
  try {
    const names = (await readdir(root)).filter((name) => name.endsWith(".md") && name !== "README.md");
    const rows: SearchCorpora["references"] = [];
    for (const name of names) {
      const text = await readFile(join(root, name), "utf8");
      rows.push({ name: name.replace(/\.md$/u, ""), text: text.slice(0, MAX_SCAN_CHARS) });
    }
    return rows;
  } catch {
    return [];
  }
}

/** 把每个项目的「旧版文件名 → 已确认 OCR 任务」建一次索引，供「查看原页」用。 */
async function buildDocumentIndex(projectIds: readonly string[]) {
  const { listConfirmedSources } = await import("@/lib/ocr/jobs");
  const byProject = new Map<string, Map<string, string>>();
  for (const projectId of projectIds) {
    const map = new Map<string, string>();
    try {
      for (const source of await listConfirmedSources({ projectId })) {
        if (!map.has(source.originalName)) map.set(source.originalName, source.jobId);
      }
    } catch {
      // 没有 OCR 目录就当作没有页图证据，不影响文字检索
    }
    byProject.set(projectId, map);
  }
  return byProject;
}

/** 跑一次检索（收集 + 匹配）。 */
export async function searchAssistant(query: AssistantQuery): Promise<AssistantResult> {
  const corpora = await collectCorpora(query);
  const ocrByProject = await buildDocumentIndex(corpora.projects.map((project) => project.id));
  const result = searchCorpora(corpora, query, { ocrByProject });
  const gaps: string[] = [];
  if (corpora.references.length === 0) {
    gaps.push("工作区里没有装语法参考知识库（knowledge/grammar/），本次没有搜到参考资料。");
  }
  if ((corpora.collectionTotal ?? 0) > (corpora.collectionDocs ?? []).length) {
    gaps.push(
      `知识库里的资料集合有 ${corpora.collectionTotal} 个模块，本次只检索了前 ${(corpora.collectionDocs ?? []).length} 个（按数量上限截断）。`,
    );
  }
  return { ...result, gaps };
}
