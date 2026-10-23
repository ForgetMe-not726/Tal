/**
 * 本地工作区的路径契约。
 *
 * 本工具是**装在老师电脑上的本地个人工具**，工作区里的文件是唯一事实源
 * （profile.md §3）。没有远程数据库、没有账户体系。
 *
 * 目录布局（对照 profile.md 的目录树；`rules/` 与 `knowledge/` 提到顶层是需求方确认的调整）：
 *
 * ```text
 * <workspace>/
 *   workspace.json                     工作区版本、基线版本
 *   rules/<rule-set-id>/               教材规则（内置基线 + 老师新增）
 *     rule.json  bindings.json  versions/<n>.json
 *   knowledge/                         参考资料（剑桥等），随包分发基线
 *     entries.json  cambridge/  other/
 *   module-definitions.json            模块目录（canonical）
 *   sources/ocr/<学期>-<书种>-ocr/        资料库：OCR 产物（老师直接打开就能看懂）
 *   projects/<project-id>/
 *     project.json
 *     sources/originals/<原文件>           原始 PDF / 图片，只复制不改写
 *     lessons/<lesson-key>/
 *       lesson.json  sources.json  context.json
 *       books/<book-type>/<module-key>/module.json  versions/<n>.json
 *     exports/
 *   .app/                              可重建：任务、日志、索引
 * ```
 *
 * 为什么 `rules/` 与 `knowledge/` 在顶层而不是项目内：
 * 规则作用域含 Global，必须跨项目生效；且它们要随安装包分发，
 * 保证每位老师装到的基线一致。
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 工作区根目录。环境变量优先，便于测试与多工作区切换。 */
export function workspaceRoot(): string {
  const override = process.env.AI_TEACHING_WORKSPACE?.trim();
  if (override) return resolve(override);
  return join(homedir(), "Documents", "AI教材工作台");
}

export const WORKSPACE_FILE = "workspace.json";
export const RULES_DIR = "rules";
export const KNOWLEDGE_DIR = "knowledge";
export const MODULE_DEFINITIONS_FILE = "module-definitions.json";
export const PROJECTS_DIR = "projects";
export const APP_DIR = ".app";
export const LESSONS_DIR = "lessons";
export const BOOKS_DIR = "books";
export const VERSIONS_DIR = "versions";
export const EXPORTS_DIR = "exports";
export const SOURCES_DIR = "sources";
export const ORIGINALS_DIR = "originals";
export const OCR_DIR = "ocr";
export const JOBS_DIR = "jobs";
export const REVIEW_DIR = "review";

export const RULE_FILE = "rule.json";
export const RULE_BINDINGS_FILE = "bindings.json";
export const KNOWLEDGE_ENTRIES_FILE = "entries.json";
export const PROJECT_FILE = "project.json";
export const LESSON_FILE = "lesson.json";
export const LESSON_SOURCES_FILE = "sources.json";
export const LESSON_CONTEXT_FILE = "context.json";
export const BOOK_FILE = "book.json";
export const MODULE_FILE = "module.json";
export const REVIEW_MANIFEST_FILE = "manifest.json";
export const REVIEW_FINDINGS_FILE = "findings.json";
export const REVIEW_DECISIONS_FILE = "decisions.json";
export const REVIEW_REPORT_FILE = "report.html";

/** 工作区结构版本。结构不兼容变更时递增，用于首次运行时提示或迁移。 */
export const WORKSPACE_SCHEMA_VERSION = 1;

/**
 * 目录名安全化。
 *
 * 规则标识、模块标识都直接用作目录名，必须挡住路径分隔符和 Windows 保留字符，
 * 否则一个带 `/` 或 `:` 的标识会写到工作区外面去。
 */
export function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return cleaned || "_";
}

/** 课时目录名：可读优先，业务 ID 存在 lesson.json 里保持稳定。 */
export function lessonDirName(lessonNumber: number): string {
  return `lesson-${String(lessonNumber).padStart(2, "0")}`;
}

export function rulesDir(): string {
  return join(workspaceRoot(), RULES_DIR);
}

export function ruleSetDir(ruleKey: string): string {
  return join(rulesDir(), safeSegment(ruleKey));
}

export function knowledgeDir(): string {
  return join(workspaceRoot(), KNOWLEDGE_DIR);
}

export function moduleDefinitionsPath(): string {
  return join(workspaceRoot(), MODULE_DEFINITIONS_FILE);
}

export function projectsDir(): string {
  return join(workspaceRoot(), PROJECTS_DIR);
}

export function projectDir(projectId: string): string {
  return join(projectsDir(), safeSegment(projectId));
}

export function projectFile(projectId: string): string {
  return join(projectDir(projectId), PROJECT_FILE);
}

export function lessonDir(projectId: string, lessonNumber: number): string {
  return join(projectDir(projectId), LESSONS_DIR, lessonDirName(lessonNumber));
}

export function lessonsDir(projectId: string): string {
  return join(projectDir(projectId), LESSONS_DIR);
}

export function lessonSourcesFile(projectId: string, lessonNumber: number): string {
  return join(lessonDir(projectId, lessonNumber), LESSON_SOURCES_FILE);
}

export function bookDir(projectId: string, lessonNumber: number, bookType: string): string {
  return join(lessonDir(projectId, lessonNumber), BOOKS_DIR, safeSegment(bookType));
}

export function moduleDir(
  projectId: string,
  lessonNumber: number,
  bookType: string,
  moduleKey: string,
): string {
  return join(bookDir(projectId, lessonNumber, bookType), safeSegment(moduleKey));
}

export function moduleVersionDir(
  projectId: string,
  lessonNumber: number,
  bookType: string,
  moduleKey: string,
): string {
  return join(moduleDir(projectId, lessonNumber, bookType, moduleKey), VERSIONS_DIR);
}

// ---------------------------------------------------------------------------
// 资料识别（OCR）
// ---------------------------------------------------------------------------

/**
 * 审校任务目录（profile §3：审校记录只保存在本地 Lesson 目录下）。
 *
 * 沿用语料库既有的 `lesson-NN` 命名（`lessonDir()`），不为审校另造一套课目录写法。
 */
export function reviewDir(projectId: string, lessonNumber: number): string {
  return join(lessonDir(projectId, lessonNumber), REVIEW_DIR);
}

export function reviewJobDir(projectId: string, lessonNumber: number, jobId: string): string {
  return join(reviewDir(projectId, lessonNumber), safeSegment(jobId));
}

/**
 * 资料库：工作区顶层的 `sources/`。
 *
 * 识别结果不放在 `projects/<UUID>/` 下面——老师要在资源管理器里直接找到它，
 * 项目序号对人是噪音。文件夹用 `<学期>-<书种>-ocr`（如 `spring-sb-ocr`），
 * 重名自动加序号，不覆盖已有结果。
 */
export function libraryDir(): string {
  return join(workspaceRoot(), SOURCES_DIR);
}

/** 原始 PDF / 图片，只复制不改写。 */
export function originalsDir(projectId: string): string {
  return join(projectDir(projectId), SOURCES_DIR, ORIGINALS_DIR);
}

export function ocrLibraryDir(): string {
  return join(libraryDir(), OCR_DIR);
}

/** 资料库里的一个识别结果目录（参数是文件夹名，不是任务 id）。 */
export function ocrJobDir(dirName: string): string {
  return join(ocrLibraryDir(), safeSegment(dirName));
}

/** 2026-10-23 之前的位置（`projects/<id>/sources/ocr/<job-id>`），只用于迁移。 */
export function legacyOcrDir(projectId: string): string {
  return join(projectDir(projectId), SOURCES_DIR, OCR_DIR);
}

export function legacyOcrJobDir(projectId: string, jobId: string): string {
  return join(legacyOcrDir(projectId), safeSegment(jobId));
}

/** 在跑任务的状态文件（可重建，不是事实源）。 */
/**
 * OCR 上游产物的**稳定落点**（不再用系统临时目录）。
 *
 * 为什么：MinerU 跑一本 83 页的书要几分钟，产物几百 MB。放在 `mkdtemp` 里，
 * 应用一重启就找不到它，只能整本重跑。放到 `.app` 下（可重建区域）后，
 * 重启可以**接着整理**已经跑完的结果。
 */
export function ocrUpstreamDir(jobId: string): string {
  return join(appDir(), "ocr-upstream", safeSegment(jobId));
}

/** 识别失败/中断的原因留一行日志：任务记录会被清掉，但排查线索不能丢。 */
export function ocrFailureLog(): string {
  return join(appDir(), "logs", "ocr-failures.log");
}

export function jobFile(jobId: string): string {
  return join(jobsDir(), `${safeSegment(jobId)}.json`);
}

export function jobsDir(): string {
  return join(appDir(), JOBS_DIR);
}

/**
 * 修改建议的 Context Pack 诊断记录。
 *
 * 放在 `.app/jobs/` 的**子目录**里，不直接平铺：`jobsDir()` 下平铺的 `*.json`
 * 会被 OCR 与审校的 `listJobs()` 当成任务记录读走，形状对不上就会污染任务列表。
 * 子目录名不以 `.json` 结尾，`readJsonDir` 天然跳过。
 */
export function suggestionJobsDir(): string {
  return join(jobsDir(), "suggestions");
}

export function suggestionJobFile(jobId: string): string {
  return join(suggestionJobsDir(), `${safeSegment(jobId)}.json`);
}

export function appDir(): string {
  return join(workspaceRoot(), APP_DIR);
}

/** 可重建区域：索引、任务、日志。删掉不丢事实。 */
export function rebuildableDirs(): string[] {
  return [jobsDir(), join(appDir(), "logs"), join(appDir(), "retrieval")];
}
