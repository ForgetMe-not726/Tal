import { getAppStore } from "@/lib/db/store";
import { bookSupportsLessonType, unsupportedLessonMessage } from "@/lib/curriculum";
import { aiComplete, type AiResult } from "@/lib/ai/gateway";
import {
  filterRuleSetByType,
  resolveEffectiveRules,
  type EffectiveRuleSet,
  type RuleResolutionContext,
} from "@/lib/rules/resolver";
import { runDeterministicChecks, type RuleCheckIssue } from "@/lib/rules/checks";
import type { BookType, Grade, LessonRow, LessonType, ModuleVersionRow } from "@/lib/db/types";
import type { SourceVerificationMode } from "@/lib/knowledge/types";
import { saveSourceImport } from "@/lib/knowledge/repository";
import type { OutlineLessonProfile } from "@/lib/outline/types";
import { firstExamSkill } from "@/lib/outline/exam-skills";
import { buildKnowledgeContext } from "@/lib/knowledge/context-builder";
import { loadGrammarReference, renderGrammarBlock, type GrammarReference } from "@/lib/knowledge/grammar-reference";
import { findExemplars, renderExemplarBlock, type CollectionChunk } from "@/lib/knowledge/collections";
import { loadRelatedVersions, type RelatedVersion } from "@/lib/knowledge/related-content";
import { htmlTablesToMarkdown } from "@/lib/markdown/html-tables";
import { retrieveKnowledge } from "@/lib/knowledge/retriever";
import { buildMigrationPlan, type MigrationPlan } from "@/lib/generation/planner";
import { buildDeterministicObjectives } from "@/lib/generation/objectives";
import { checkEnglishOnly, checkVocabularyCoverage } from "@/lib/generation/coverage";
import { resolveModuleOutlineByKey } from "@/lib/modules/service";
import type { ModuleOutline } from "@/lib/modules/directory";
import { sourceUnitForTargetLesson } from "@/lib/knowledge/legacy-markdown";

export class GenerationServiceError extends Error {}

export type GenerationContextInput = {
  projectId?: string;
  projectName?: string;
  grade: Grade;
  term: string;
  lessonId?: string;
  lessonNumber: number;
  lessonTitle: string;
  bookType: BookType;
  moduleKey: string;
  moduleLabel: string;
  /** 课型；决定学生用书挂哪些模块（复习课没有 explore/read）。 */
  lessonType?: LessonType;
  lessonProfile?: OutlineLessonProfile;
  outlineVersion?: string;
};

export type GenerationRequest = GenerationContextInput & {
  /** 兼容旧请求字段:已核验来源必须同时传 sourceConfirmed=true。 */
  sourceText?: string;
  sourceRawText?: string;
  sourceConfirmed?: boolean;
  sourceModuleId?: string;
  sourceBookType?: BookType;
  sourceDocument?: string;
  sourceVerificationMode?: SourceVerificationMode;
  referenceText?: string;
};

export type GenerationContext = GenerationContextInput & {
  projectId: string;
  lessonId: string;
  bookId: string;
  moduleId: string;
  /** 落库后的实际课型（客户端没传时用库里已有的）。 */
  lessonType: LessonType;
};

export type SavedModuleVersion = ModuleVersionRow;

export type GenerationResult = {
  context: GenerationContext;
  markdown: string;
  version: SavedModuleVersion;
  checks: RuleCheckIssue[];
  rules: EffectiveRuleSet["snapshot"];
  migrationPlan: MigrationPlan;
  retrieval: ReturnType<typeof buildKnowledgeContext>["trace"];
  ai: Pick<AiResult, "model" | "provider" | "usage" | "latencyMs" | "stopReason">;
  sourceRefs: string[];
  /** 本次参考的范本（知识库集合里的同模块定稿）；没有范本时为 null。 */
  exemplar: {
    collectionTitle: string;
    lessonNumber: number;
    pages: [number, number] | null;
  } | null;
};

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new GenerationServiceError(`${label}不能为空`);
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new GenerationServiceError(`${label}必须是正整数`);
  return number;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new GenerationServiceError("生成请求已取消,未保存新版本");
}

/**
 * Markdown 表格不支持单元格内换行。模型偶尔会把多行内容直接写进单元格，
 * 导致表格断行、渲染错乱；这里把断掉的表格行重新拼回一行。
 */
function repairTableRows(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("|")) {
      output.push(line);
      continue;
    }
    let merged = line.trimEnd();
    while (!merged.endsWith("|") && index + 1 < lines.length) {
      const next = lines[index + 1].trim();
      if (!next || next.startsWith("#") || next.startsWith("|")) break;
      merged = `${merged}；${next}`;
      index += 1;
    }
    output.push(merged);
  }
  return output.join("\n");
}

function cleanMarkdown(text: string): string {
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  return repairTableRows(
    htmlTablesToMarkdown(
      body
        .trim()
        // 模型偶尔会输出 <br> 换行；Markdown 不解析裸 HTML，统一转成真正的换行。
        .replace(/<br\s*\/?>/gi, "\n"),
    ),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLessonProfile(value: unknown, expectedLessonNumber: number): OutlineLessonProfile | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GenerationServiceError("大纲 Lesson Profile 格式无效");
  }
  const source = value as Record<string, unknown>;
  const lessonNumber = Number(source.lessonNumber);
  if (!Number.isInteger(lessonNumber) || lessonNumber !== expectedLessonNumber) {
    throw new GenerationServiceError("大纲 Lesson Profile 与当前 Lesson 编号不一致");
  }
  const text = (key: string, max = 4000): string | null => {
    const candidate = source[key];
    if (candidate == null) return null;
    if (typeof candidate !== "string") throw new GenerationServiceError(`大纲字段无效:${key}`);
    return candidate.trim().slice(0, max) || null;
  };
  const locatorValue = source.sourceCell;
  if (!locatorValue || typeof locatorValue !== "object" || Array.isArray(locatorValue)) {
    throw new GenerationServiceError("大纲 Lesson Profile 缺少来源单元格定位");
  }
  const locator = locatorValue as Record<string, unknown>;
  const sheet = textFromRecord(locator, "sheet", 120);
  const address = textFromRecord(locator, "address", 40);
  const row = Number(locator.row);
  const column = Number(locator.column);
  if (!sheet || !address || !Number.isInteger(row) || !Number.isInteger(column) || row <= 0 || column <= 0) {
    throw new GenerationServiceError("大纲来源单元格定位无效");
  }
  const examSkills = text("examSkills");
  const annotations = normalizeProfileArray(source.annotations, "annotations");
  const mappings = normalizeProfileArray(source.mappings, "mappings");
  const rawValues = source.rawValues && typeof source.rawValues === "object" && !Array.isArray(source.rawValues)
    ? Object.fromEntries(Object.entries(source.rawValues as Record<string, unknown>).slice(0, 40).flatMap(([key, item]) => typeof item === "string" ? [[key.slice(0, 120), item.slice(0, 2000)]] : []))
    : {};
  return {
    lessonNumber,
    lessonKey: text("lessonKey", 120) ?? `lesson_${lessonNumber}`,
    title: text("title", 500) ?? "",
    targetTitle: text("targetTitle", 500) ?? text("title", 500) ?? "",
    sourceCell: { sheet, address, row, column },
    sourceCellText: text("sourceCellText", 4000) ?? "",
    rawValues,
    theme: text("theme"),
    coreVocabulary: text("coreVocabulary"),
    reading: text("reading"),
    useOfEnglish: text("useOfEnglish"),
    readingExamType: text("readingExamType"),
    grammar: text("grammar"),
    examSkills,
    // 默认只做一个题型：旧调用方没带 primaryExamSkill 就从完整列表里取第一个
    primaryExamSkill: text("primaryExamSkill", 500) ?? firstExamSkill(examSkills),
    listening: text("listening"),
    speaking: text("speaking"),
    writing: text("writing"),
    annotations: annotations as OutlineLessonProfile["annotations"],
    mappings: mappings as OutlineLessonProfile["mappings"],
  };
}

function textFromRecord(value: Record<string, unknown>, key: string, max: number): string | null {
  return typeof value[key] === "string" && value[key].trim() ? value[key].trim().slice(0, max) : null;
}

function normalizeProfileArray(value: unknown, key: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new GenerationServiceError(`大纲字段无效:${key}`);
  return value.slice(0, 40).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new GenerationServiceError(`大纲字段无效:${key}`);
    return item;
  });
}

export function normalizeGenerationInput(raw: Record<string, unknown>): GenerationRequest {
  const grade = requireText(raw.grade, "年级") as Grade;

  const bookType = requireText(raw.bookType, "书种") as BookType;
  const lessonNumber = requirePositiveInteger(raw.lessonNumber, "Lesson 编号");
  const moduleKey = requireText(raw.moduleKey, "模块标识");
  const moduleLabel = requireText(raw.moduleLabel ?? raw.moduleKey, "模块名称");
  const lessonTitle = requireText(raw.lessonTitle, "Lesson 标题");
  const term = requireText(raw.term ?? "winter", "学期");
  const sourceBookType = typeof raw.sourceBookType === "string" ? (raw.sourceBookType as BookType) : undefined;
  if (!["L1", "L2", "L3", "L4", "L5", "L6"].includes(grade)) throw new GenerationServiceError("年级必须是 L1-L6");
  if (!["student", "workbook", "knowledge", "vocab"].includes(bookType)) throw new GenerationServiceError("书种不受支持");
  if (sourceBookType && !["student", "workbook", "knowledge", "vocab"].includes(sourceBookType)) {
    throw new GenerationServiceError("来源书种不受支持");
  }
  return {
    projectId: typeof raw.projectId === "string" ? raw.projectId : undefined,
    projectName: typeof raw.projectName === "string" ? raw.projectName : undefined,
    grade,
    term,
    lessonId: typeof raw.lessonId === "string" ? raw.lessonId : undefined,
    lessonNumber,
    lessonTitle,
    bookType,
    moduleKey,
    moduleLabel,
    lessonType: raw.lessonType === "revision" ? "revision" : raw.lessonType === "regular" ? "regular" : undefined,
    sourceText: typeof raw.sourceText === "string" ? raw.sourceText : undefined,
    sourceRawText: typeof raw.sourceRawText === "string" ? raw.sourceRawText : undefined,
    sourceConfirmed: raw.sourceConfirmed === true,
    sourceModuleId: typeof raw.sourceModuleId === "string" ? raw.sourceModuleId : undefined,
    sourceBookType,
    sourceDocument: typeof raw.sourceDocument === "string" ? raw.sourceDocument.trim().slice(0, 240) || undefined : undefined,
    sourceVerificationMode: raw.sourceVerificationMode === "verified_ocr_import" || raw.sourceVerificationMode === "verified_outline_import"
      ? raw.sourceVerificationMode
      : "manual_confirmation",
    referenceText: typeof raw.referenceText === "string" ? raw.referenceText : undefined,
    lessonProfile: normalizeLessonProfile(raw.lessonProfile, lessonNumber),
    outlineVersion: typeof raw.outlineVersion === "string" ? raw.outlineVersion.trim().slice(0, 100) || undefined : undefined,
  };
}

async function ensureProjectAndLesson(input: GenerationContextInput) {
  const store = getAppStore();
  const projectName = input.projectName?.trim() || `${input.grade} ${input.term} 教材迁移`;
  let project = input.projectId ? await store.getProjectById(input.projectId) : null;
  if (input.projectId && !project) throw new GenerationServiceError("项目不存在");
  if (project && (project.grade !== input.grade || project.term !== input.term)) {
    throw new GenerationServiceError("项目的年级或学期与当前迁移上下文不一致");
  }
  project ??= await store.getProjectByNaturalKey(projectName, input.grade, input.term);
  project ??= await store.insertProject({ name: projectName, grade: input.grade, term: input.term });

  let lesson = input.lessonId ? await store.getLessonById(input.lessonId) : null;
  if (input.lessonId && (!lesson || lesson.project_id !== project.id)) {
    throw new GenerationServiceError("Lesson 不存在或不属于当前项目");
  }
  lesson ??= await store.getLessonByNaturalKey(project.id, input.lessonNumber);
  // 课型由老师在界面上选，随生成请求一起落库；改了就要同步，否则模块列表会对不上。
  const patch: Partial<Pick<LessonRow, "title" | "lesson_type">> = {};
  if (lesson && lesson.title !== input.lessonTitle) patch.title = input.lessonTitle;
  if (lesson && input.lessonType && lesson.lesson_type !== input.lessonType) {
    patch.lesson_type = input.lessonType;
  }
  if (lesson && Object.keys(patch).length > 0) {
    lesson = await store.updateLesson(lesson.id, patch);
  }
  lesson ??= await store.insertLesson({
    project_id: project.id,
    lesson_number: input.lessonNumber,
    title: input.lessonTitle,
    lesson_type: input.lessonType,
  });
  return { projectId: project.id, lessonId: lesson.id, lessonType: lesson.lesson_type };
}

async function ensureBookAndModule(input: GenerationContextInput, projectId: string, lessonId: string) {
  const store = getAppStore();
  let book = await store.getBook(lessonId, input.bookType);
  book ??= await store.insertBook({ lesson_id: lessonId, book_type: input.bookType });
  let moduleRow = await store.getModule(book.id, input.moduleKey);
  moduleRow ??= await store.insertModule({
    book_id: book.id,
    module_key: input.moduleKey,
    display_name: input.moduleLabel,
    sort_order: 0,
  });
  return { bookId: book.id, moduleId: moduleRow.id, projectId };
}

export async function ensureGenerationContext(input: GenerationContextInput): Promise<GenerationContext> {
  const ids = await ensureProjectAndLesson(input);
  const moduleInfo = await ensureBookAndModule(input, ids.projectId, ids.lessonId);
  return { ...input, ...ids, ...moduleInfo };
}

function resolutionContext(context: GenerationContext): RuleResolutionContext {
  return {
    projectId: context.projectId,
    grade: context.grade,
    bookType: context.bookType,
    moduleKey: context.moduleKey,
    lessonId: context.lessonId,
  };
}

function hardRuleIssues(ruleSet: EffectiveRuleSet, checks: RuleCheckIssue[]) {
  const hardKeys = new Set(ruleSet.hardRules.map((item) => item.rule.rule_key));
  return checks.filter((issue) => hardKeys.has(issue.ruleKey));
}

async function nextVersionNumber(moduleId: string): Promise<number> {
  const versions = await getAppStore().listModuleVersions({ moduleId });
  return (versions[0]?.version_number ?? 0) + 1;
}

async function saveModuleVersion(
  context: GenerationContext,
  markdown: string,
  originKind: "ai_generated" | "teacher_edited",
  originSummary: { copy: number; adapt: number; generate: number },
  metadata: Record<string, unknown>,
): Promise<SavedModuleVersion> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const versionNumber = await nextVersionNumber(context.moduleId);
    try {
      return await getAppStore().insertModuleVersion({
        module_id: context.moduleId,
        version_number: versionNumber,
        content: { markdown, metadata },
        content_format: "markdown",
        origin_kind: originKind,
        origin_summary: originSummary,
        created_by: originKind === "ai_generated" ? "ai" : "teacher",
      });
    } catch (error) {
      lastError = error as Error;
      if (!/conflict|冲突|unique|duplicate|23505/i.test(lastError.message)) break;
    }
  }
  throw new GenerationServiceError(`保存模块版本失败:版本号冲突,请重试:${lastError?.message ?? "unknown"}`);
}

async function validateParentVersion(context: GenerationContext, basedOnVersionId?: string) {
  if (!basedOnVersionId) return [];
  const parent = await getAppStore().getModuleVersion(basedOnVersionId);
  if (!parent) throw new GenerationServiceError("父版本不存在");
  const moduleRow = await getAppStore().getModule(context.bookId, context.moduleKey);
  if (!moduleRow || parent.module_id !== moduleRow.id) throw new GenerationServiceError("父版本不属于当前模块");
  const metadata = parent.content && typeof parent.content === "object" ? (parent.content as { metadata?: unknown }).metadata : null;
  const refs = metadata && typeof metadata === "object" ? (metadata as { source_refs?: unknown }).source_refs : null;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string") : [];
}

function buildPrompt(
  context: GenerationContext,
  outline: ModuleOutline,
  ruleSet: EffectiveRuleSet,
  sourceText: string,
  migrationPlan: MigrationPlan,
  relatedVersions: RelatedVersion[],
  request: GenerationRequest,
  grammarReference: GrammarReference | null,
  exemplars: CollectionChunk[],
): string {
  const relatedBlock = relatedVersions
    .filter((item) => item.markdown)
    .map((item) => `### ${item.bookType}/${item.moduleKey} ${item.moduleLabel}\n${item.markdown}`)
    .join("\n\n");
  const profile = request.lessonProfile;
  const sourceUnit = profile ? sourceUnitForTargetLesson(profile) : null;
  const outlineBlock = profile
    ? [
        `Lesson：${profile.targetTitle || profile.title}`,
        `主题：${profile.theme || "（大纲未提供，留空）"}`,
        `目标词汇：${profile.coreVocabulary || "（大纲未提供，留空）"}`,
        `核心语法：${profile.grammar || "（大纲未提供，留空）"}`,
        `阅读文章：${profile.reading || "（大纲未提供，留空）"}`,
        `阅读题型：${profile.readingExamType || "（大纲未提供，留空）"}`,
        `技能训练：${profile.primaryExamSkill || profile.examSkills || "（大纲未提供，留空）"}`,
        sourceUnit ? `旧版对应讲次：旧第 ${sourceUnit} 讲` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "（未导入大纲。）";

  const rulesBlock =
    ruleSet.allRules
      .map(
        (item) =>
          `- ${item.rule.rule_key}${item.rule.is_hard ? "（红线，必须遵守）" : ""}：${item.version.instruction}`,
      )
      .join("\n") || "（当前没有生效规则。）";

  // 骨架按（书种, 模块）取，且解析不出来时在更上游就抛错了，这里不再有兜底文案。
  const skeletonBlock = `本模块是「${outline.displayName}」。严格按下面的结构输出：\n\n${outline.outline}`;

  // 本课语法参考：只带本课那一个语法点，取不到就如实说明（不拿模型印象冒充依据）
  const grammarBlock = renderGrammarBlock(grammarReference);
  // 同模块范本：已定稿教材里同一个模块长什么样——比"输出结构"更能说明详略与排版
  const exemplarBlock = renderExemplarBlock(exemplars, htmlTablesToMarkdown);

  return `你是教材迁移流水线中的 Content Generator，负责把旧版教材内容迁移成新版教材的对应模块。

任务：为 ${context.grade} ${context.term} Lesson ${context.lessonNumber}「${context.lessonTitle}」生成【${context.moduleLabel}】模块的新版初稿。

工作原则：Preserve → Adapt → Generate。能用旧版内容的先沿用，不符合新版结构的改写，旧版没有的才生成。

硬性要求：
1. 只输出这一个模块的最终正文，用 Markdown。不要输出分析过程、不要用代码围栏包住整篇。
2. 绝对不要把下面的“目标大纲”“规则”“来源”原文抄回正文，也不要输出 JSON 或字段清单。
3. 目标词汇、语法名称、阅读文章和题型以大纲为准，不得改动；旧版来源提供词条细节、例句和讲解。
4. 大纲标注“（大纲未提供，留空）”的字段，在输出里对应位置留空，不要用其他字段的内容顶上，也不要编造。
5. 旧版来源是已经人工核验过的正式材料，直接采用其中的注音、词性、释义、搭配、拓展和例句，并整理成目标格式；不要标记成待确认，也不要改写原意。
6. 首要目标是先把新版框架完整搭起来：模块、小节、表格表头、题干、序号一律齐全。能由旧版来源映射的内容照常填进去；来源确实没有的字段**保持空白**，不要写“（待人工确认）”“待补充”“暂无”这类占位文字——占位文字会被误当成正文，也会挡住后续的填充。任何时候都不要编造事实。
7. 正文里的层级标题用二级（##）表示模块、三级（###）表示子栏目。
8. 表格一律用 Markdown 表格语法（竖线分列 + 分隔行），**绝对不要输出 HTML 标签**（table / tr / td / br 之类）；旧版来源里若出现 HTML 表格，先按它的行列还原成 Markdown 表格再输出。
${context.bookType === "knowledge" ? "" : "9. 学生用书和练习册正文一律英文（英式拼写）。大纲、规则或参考材料里的中文说明只作理解用，不得原样写进正文，尤其不要用中文做语法标题或目标条目。"}

【目标大纲（这是目标要求，不是要输出的内容）】
${outlineBlock}

【本课语法参考（写这个语法点时对照它，不要照抄）】
${grammarBlock}

【同模块范本（已定稿教材，照着它的结构、详略和排版写；内容必须用本课来源）】
${exemplarBlock}

【必须遵守的制作规则（这是约束，不是要输出的内容）】
${rulesBlock}

【输出结构】
${skeletonBlock}

【用户补充参考（老师直接给出的确认信息，优先级高于旧版来源材料）】
${request.referenceText?.trim() || "（无）"}

【同一 Lesson 的其他已确认内容】
${relatedBlock || "（无）"}

【旧版来源材料（迁移素材，可能不完整或有 OCR 噪声）】
${sourceText || "（本模块没有对应旧版来源：按大纲把框架搭好，能由大纲确定的内容照常输出，其余留空。）"}

现在只输出【${context.moduleLabel}】的 Markdown 正文。`;
}

export async function saveSourceContent(request: GenerationRequest) {
  if (!request.sourceText?.trim()) throw new GenerationServiceError("来源摘录不能为空");
  if (!request.sourceConfirmed) throw new GenerationServiceError("来源必须先标记为已核验");
  const result = await saveSourceImport({
    projectId: request.projectId,
    projectName: request.projectName,
    grade: request.grade,
    term: request.term,
    lessonId: request.lessonId,
    lessonNumber: request.lessonNumber,
    lessonTitle: request.lessonTitle,
    sourceBookType: request.sourceBookType ?? request.bookType,
    targetBookType: request.bookType,
    moduleKey: request.moduleKey,
    moduleLabel: request.moduleLabel,
    rawText: request.sourceRawText,
    confirmedText: request.sourceText,
    sourceDocument: request.sourceDocument,
    verificationMode: request.sourceVerificationMode,
    status: "confirmed",
  });
  const context = await ensureGenerationContext(request);
  return { context, sourceRef: result.entry.source_ref, sourceModule: result.sourceModule };
}

export async function generateModule(request: GenerationRequest, signal?: AbortSignal): Promise<GenerationResult> {
  throwIfAborted(signal);
  const context = await ensureGenerationContext(request);
  throwIfAborted(signal);
  // 复习课不产出知识清单：在取骨架、调模型之前就拒绝，给出可读原因
  if (!bookSupportsLessonType(context.bookType, context.lessonType)) {
    throw new GenerationServiceError(
      unsupportedLessonMessage(context.bookType, context.lessonType) ?? "该书种不支持当前课型",
    );
  }
  const sourceBookType = request.sourceBookType ?? request.bookType;
  if (request.sourceText?.trim()) {
    if (!request.sourceConfirmed) throw new GenerationServiceError("请先导入已核验的 OCR 来源,再开始生成");
    throwIfAborted(signal);
    await saveSourceImport({
      projectId: context.projectId,
      projectName: request.projectName,
      grade: context.grade,
      term: context.term,
      lessonId: context.lessonId,
      lessonNumber: context.lessonNumber,
      lessonTitle: context.lessonTitle,
      sourceBookType,
      targetBookType: context.bookType,
      moduleKey: context.moduleKey,
      moduleLabel: context.moduleLabel,
      rawText: request.sourceRawText,
      confirmedText: request.sourceText,
      status: "confirmed",
    });
  }
  throwIfAborted(signal);

  // 骨架按（书种, 模块, 课型）解析——复习课的小节结构与常规课不同。
  // 查不到会在这里抛错，不会静默产出结构不受控的稿子。
  const outline = await resolveModuleOutlineByKey(
    context.bookType,
    context.moduleKey,
    context.lessonType,
  );
  throwIfAborted(signal);

  const [ruleSet, retrievalResult, relatedVersions] = await Promise.all([
    // 生成只看**生成规则**：审校规则检查的是"成品该长什么样"，
    // 迁移阶段搬的是旧版教材，天然满足不了（会把老师卡在保存上）。
    resolveEffectiveRules(resolutionContext(context)).then((set) =>
      filterRuleSetByType(set, "generation"),
    ),
    retrieveKnowledge({
      projectId: context.projectId,
      lessonId: context.lessonId,
      grade: context.grade,
      bookType: context.bookType,
      sourceBookType,
      targetModuleKey: context.moduleKey,
      targetModuleLabel: context.moduleLabel,
      allowSemanticFallback: false,
    }),
    // 同一 Lesson 的其他已确认内容（共用加载器：生成与修改建议用同一套口径）
    loadRelatedVersions({ lessonId: context.lessonId, excludeModuleId: context.moduleId }).then(
      (result) => result.versions,
    ),
  ]);
  throwIfAborted(signal);
  // 本课语法参考：按大纲的语法字段取（只带本课那一个点）。取不到就如实为空，不假装有。
  const grammarReference = await loadGrammarReference({
    grammar: request.lessonProfile?.grammar ?? null,
  });
  // 同书种、同模块的范本（只取一份，按预算截断）
  const exemplars = (
    await findExemplars({
      bookType: context.bookType,
      moduleKey: context.moduleKey,
      grade: context.grade,
      maxChunks: 1,
      // 一个模块正文通常 3–8 KB；6000 会把 7 KB 的范本整个跳过（实测跳过了最接近的 L9）
      maxChars: 9000,
    })
  ).chunks;
  throwIfAborted(signal);
  // 课时目标不调模型：学生用书优先用旧版 I can 清单，知识清单用大纲字段。
  const deterministic =
    outline.deterministic && request.lessonProfile
      ? buildDeterministicObjectives(outline.deterministic, request.lessonProfile, {
          revision: context.lessonType === "revision",
          sourceText: request.sourceText,
        })
      : null;
  // 确定性模块不能悄悄退回模型去“翻译”大纲；没有可用事实就明确报错
  if (outline.deterministic && !deterministic) {
    throw new GenerationServiceError(
      outline.deterministic === "objectives_lesson_page"
        ? "课时目标没有可用内容：旧版学生用书缺少「I can」清单，大纲字段也没有可用的英文项"
        : "课时目标没有可用内容：大纲的目标词汇、语法、阅读和技能均为空",
    );
  }
  if (retrievalResult.entries.length === 0 && !deterministic) {
    throw new GenerationServiceError("没有找到已确认的结构化来源;请先导入并确认来源模块及映射");
  }
  const knowledgeContext = buildKnowledgeContext({
    entries: retrievalResult.entries,
    trace: retrievalResult.trace,
    ruleSet,
    relatedContent: relatedVersions.map((item) => ({ label: `${item.bookType}/${item.moduleKey} ${item.moduleLabel}`, markdown: item.markdown })),
    lessonContext: request.lessonProfile
      ? {
          lessonKey: request.lessonProfile.lessonKey,
          theme: request.lessonProfile.theme,
          coreVocabulary: request.lessonProfile.coreVocabulary,
          reading: request.lessonProfile.reading,
          useOfEnglish: request.lessonProfile.useOfEnglish,
          readingExamType: request.lessonProfile.readingExamType,
          grammar: request.lessonProfile.grammar,
          examSkills: request.lessonProfile.examSkills,
          outlineVersion: request.outlineVersion ?? null,
          sourceCell: request.lessonProfile.sourceCell,
        }
      : null,
  });
  const migrationPlan = buildMigrationPlan({
    lessonProfile: request.lessonProfile,
    outlineVersion: request.outlineVersion,
    moduleKey: context.moduleKey,
    moduleLabel: context.moduleLabel,
    entries: retrievalResult.entries,
    rules: ruleSet.allRules,
  });
  const prompt = deterministic
    ? ""
    : buildPrompt(
        context,
        outline,
        ruleSet,
        knowledgeContext.sourceText,
        migrationPlan,
        relatedVersions,
        request,
        grammarReference,
        exemplars,
      );
  throwIfAborted(signal);
  const ai = deterministic
    ? null
    : await aiComplete({
        task: "generation",
        system: "你必须忠实处理已确认的教材来源。不要把未提供的信息包装成事实;输出适合老师继续编辑的 Markdown。",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 8192,
      });
  throwIfAborted(signal);
  if (ai?.stopReason === "max_tokens") throw new GenerationServiceError("AI 输出达到长度上限,未保存不完整版本;请缩小来源范围后重试");
  const markdown = deterministic ?? cleanMarkdown(ai?.text ?? "");
  if (!markdown) throw new GenerationServiceError("生成内容为空,未保存版本");
  // 规则检查 + 内置覆盖检查。覆盖检查看的是「大纲要求的内容有没有进正文」，
  // 数据来自 Lesson Profile 而不是规则，所以单独算再合并（见 coverage.ts）。
  const checks = [
    ...runDeterministicChecks(ruleSet.allRules, {
      text: markdown,
      metadata: { sourceAnnotations: knowledgeContext.sourceRefs, sourceConfirmed: true },
    }),
    // 课时目标是“目标清单”，本来就不该覆盖全部核心词汇；对确定性模块做词汇覆盖检查
    // 只会每课报一次假阳性（实测一次报 14 个词全缺）。
    ...(deterministic ? [] : checkVocabularyCoverage(markdown, request.lessonProfile?.coreVocabulary)),
    ...checkEnglishOnly(markdown, context.bookType),
  ];
  const hardIssues = hardRuleIssues(ruleSet, checks);
  if (hardIssues.length > 0) {
    throw new GenerationServiceError(`生成结果触发 Hard Rule,未保存:${hardIssues.map((issue) => issue.message).join("; ")}`);
  }
  throwIfAborted(signal);
  const version = await saveModuleVersion(context, markdown, "ai_generated", migrationPlan.summary, {
    pipeline: "mvp-generation",
    generated_at: new Date().toISOString(),
    migration_plan: migrationPlan,
    outline_trace: request.lessonProfile
      ? {
          outline_version: request.outlineVersion ?? null,
          lesson_key: request.lessonProfile.lessonKey,
          source_cell: request.lessonProfile.sourceCell,
          mappings: request.lessonProfile.mappings,
        }
      : null,
    // 大纲字段随版本落库：审校要用它判断"是否超纲、核心词汇是否还在"，
    // 而审校侧拿不到前端解析的大纲——不落库就只能跳过这些检查。
    lesson_profile: request.lessonProfile
      ? {
          theme: request.lessonProfile.theme ?? null,
          coreVocabulary: request.lessonProfile.coreVocabulary ?? null,
          grammar: request.lessonProfile.grammar ?? null,
          reading: request.lessonProfile.reading ?? null,
          examSkills: request.lessonProfile.examSkills ?? null,
        }
      : null,
    rule_snapshot: ruleSet.snapshot,
    source_refs: knowledgeContext.sourceRefs,
    retrieval_trace: retrievalResult.trace,
    checks,
    ai: ai
      ? {
          provider: ai.provider,
          model: ai.model,
          usage: ai.usage,
          latency_ms: ai.latencyMs,
          stop_reason: ai.stopReason ?? null,
        }
      : { provider: "deterministic", model: "outline-mapping", usage: { inputTokens: 0, outputTokens: 0 } },
  });
  return {
    context,
    markdown,
    version,
    checks,
    rules: ruleSet.snapshot,
    migrationPlan,
    retrieval: retrievalResult.trace,
    ai: ai
      ? {
          provider: ai.provider,
          model: ai.model,
          usage: ai.usage,
          latencyMs: ai.latencyMs,
          stopReason: ai.stopReason,
        }
      : {
          provider: "deterministic",
          model: "outline-mapping",
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          stopReason: undefined,
        },
    sourceRefs: knowledgeContext.sourceRefs,
    // 老师要能知道"这次参考了哪份范本"——否则输出像某本书却说不清为什么
    exemplar: exemplars[0]
      ? {
          collectionTitle: exemplars[0].collectionTitle,
          lessonNumber: exemplars[0].lessonNumber,
          pages: exemplars[0].pages,
        }
      : null,
  };
}

export async function saveEditedModule(
  request: GenerationRequest,
  markdown: string,
  basedOnVersionId?: string,
): Promise<{ context: GenerationContext; version: SavedModuleVersion; checks: RuleCheckIssue[] }> {
  const content = requireText(markdown, "正文");
  const context = await ensureGenerationContext(request);
  const sourceRefs = await validateParentVersion(context, basedOnVersionId);
  const ruleSet = filterRuleSetByType(
    await resolveEffectiveRules(resolutionContext(context)),
    "generation",
  );
  const checks = [
    ...runDeterministicChecks(ruleSet.allRules, {
      text: content,
      metadata: { sourceAnnotations: sourceRefs, sourceConfirmed: sourceRefs.length > 0 },
    }),
    ...checkVocabularyCoverage(content, request.lessonProfile?.coreVocabulary),
  ];
  const hardIssues = hardRuleIssues(ruleSet, checks);
  if (hardIssues.length > 0) {
    throw new GenerationServiceError(`保存结果触发 Hard Rule,未保存:${hardIssues.map((issue) => issue.message).join("; ")}`);
  }
  const version = await saveModuleVersion(context, content, "teacher_edited", { copy: 0, adapt: 1, generate: 0 }, {
    pipeline: "mvp-manual-edit",
    saved_at: new Date().toISOString(),
    based_on_version_id: basedOnVersionId ?? null,
    outline_trace: request.lessonProfile
      ? {
          outline_version: request.outlineVersion ?? null,
          lesson_key: request.lessonProfile.lessonKey,
          source_cell: request.lessonProfile.sourceCell,
          mappings: request.lessonProfile.mappings,
        }
      : null,
    // 与生成路径一致：大纲字段随版本落库，审校据此判断"是否超纲、核心词汇是否还在"
    lesson_profile: request.lessonProfile
      ? {
          theme: request.lessonProfile.theme ?? null,
          coreVocabulary: request.lessonProfile.coreVocabulary ?? null,
          grammar: request.lessonProfile.grammar ?? null,
          reading: request.lessonProfile.reading ?? null,
          examSkills: request.lessonProfile.examSkills ?? null,
        }
      : null,
    rule_snapshot: ruleSet.snapshot,
    source_refs: sourceRefs,
    checks,
  });
  await getAppStore().updateModuleStatus(context.moduleId, "confirmed");
  return { context, version, checks };
}
