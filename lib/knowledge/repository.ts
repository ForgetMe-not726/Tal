import { createHash } from "node:crypto";
import { getAppStore } from "@/lib/db/store";
import type { BookType, ModuleMappingRow } from "@/lib/db/types";
import type { SourceImportInput, SourceImportResult, SourceReviewStatus } from "@/lib/knowledge/types";

export class KnowledgeRepositoryError extends Error {}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new KnowledgeRepositoryError(`${label}不能为空`);
  return value.trim();
}

function sourceFingerprint(input: {
  projectId: string;
  lessonId: string;
  sourceBookType: BookType;
  moduleKey: string;
  content: string;
  sourceDocument?: string;
  page?: number;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.projectId,
        input.lessonId,
        input.sourceBookType,
        input.moduleKey,
        input.content,
        input.sourceDocument?.trim() || "manual_input",
        input.page ?? null,
      ]),
    )
    .digest("hex");
}

async function ensureProjectAndLesson(input: SourceImportInput): Promise<{ projectId: string; lessonId: string }> {
  const store = getAppStore();
  const projectName = input.projectName?.trim() || `${input.grade} ${input.term} 教材迁移`;
  let project = input.projectId ? await store.getProjectById(input.projectId) : null;
  if (input.projectId && !project) throw new KnowledgeRepositoryError("项目不存在");
  if (project && (project.grade !== input.grade || project.term !== input.term)) {
    throw new KnowledgeRepositoryError("项目的年级或学期与来源上下文不一致");
  }
  project ??= await store.getProjectByNaturalKey(projectName, input.grade, input.term);
  project ??= await store.insertProject({ name: projectName, grade: input.grade, term: input.term });

  let lesson = input.lessonId ? await store.getLessonById(input.lessonId) : null;
  if (input.lessonId && (!lesson || lesson.project_id !== project.id)) {
    throw new KnowledgeRepositoryError("Lesson 不存在或不属于当前项目");
  }
  lesson ??= await store.getLessonByNaturalKey(project.id, input.lessonNumber);
  if (lesson) {
    if (lesson.title !== input.lessonTitle) lesson = await store.updateLesson(lesson.id, { title: input.lessonTitle });
  } else {
    lesson = await store.insertLesson({
      project_id: project.id,
      lesson_number: input.lessonNumber,
      title: input.lessonTitle,
    });
  }
  return { projectId: project.id, lessonId: lesson.id };
}

function sourcePayload(input: SourceImportInput, status: SourceReviewStatus, sourceRef: string) {
  const verifiedImport = input.verificationMode === "verified_ocr_import" || input.verificationMode === "verified_outline_import";
  return {
    source_status: status,
    source_kind: input.verificationMode ?? "manual_import",
    verification_mode: input.verificationMode ?? "manual_confirmation",
    source_ref: sourceRef,
    source_document: input.sourceDocument?.trim() || "manual_input",
    page: input.page ?? null,
    raw_ocr: input.rawText?.trim() || null,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    confirmed_by: status === "confirmed" ? (verifiedImport ? input.verificationMode : "teacher") : null,
    notes: input.notes?.trim() || "",
    module_key: input.moduleKey,
  } satisfies Record<string, unknown>;
}

export async function saveSourceImport(input: SourceImportInput): Promise<SourceImportResult> {
  const moduleKey = requireText(input.moduleKey, "来源模块标识");
  const moduleLabel = requireText(input.moduleLabel, "来源模块名称");
  const confirmedText = input.confirmedText?.trim() ?? "";
  const rawText = input.rawText?.trim() ?? "";
  if (input.status === "confirmed" && !confirmedText) {
    throw new KnowledgeRepositoryError("确认来源时必须提供人工核对后的正文");
  }
  if (!rawText && !confirmedText) throw new KnowledgeRepositoryError("原始线索或确认正文至少提供一项");

  const { projectId, lessonId } = await ensureProjectAndLesson(input);
  const store = getAppStore();
  const fingerprint = sourceFingerprint({
    projectId,
    lessonId,
    sourceBookType: input.sourceBookType,
    moduleKey,
    content: confirmedText || rawText,
    sourceDocument: input.sourceDocument,
    page: input.page,
  });
  const sourceRef = `manual:${fingerprint}`;
  const existing = await store.getKnowledgeEntryBySourceRef(sourceRef);
  if (existing) {
    const existingModule = existing.source_module_id
      ? await store.getSourceModule(existing.source_module_id)
      : null;
    if (!existingModule) throw new KnowledgeRepositoryError("来源条目存在但来源模块缺失");
    if (input.status === "confirmed" && existing.payload.source_status !== "confirmed") {
      const payload = {
        ...existing.payload,
        ...sourcePayload(input, "confirmed", sourceRef),
      };
      const upgradedEntry = await store.updateKnowledgeEntry(existing.id, {
        content: confirmedText,
        payload,
      });
      const upgradedModule = await store.updateSourceModule(existingModule.id, {
        status: "confirmed",
        payload: { ...existingModule.payload, ...payload },
      });
      return {
        projectId,
        lessonId,
        sourceModule: upgradedModule,
        entry: upgradedEntry,
        mappings: await store.listModuleMappings({ sourceModuleIds: [existingModule.id] }),
        deduplicated: true,
      };
    }
    return {
      projectId,
      lessonId,
      sourceModule: existingModule,
      entry: existing,
      mappings: await store.listModuleMappings({ sourceModuleIds: [existingModule.id] }),
      deduplicated: true,
    };
  }

  const sourceModule = await store.insertSourceModule({
    project_id: projectId,
    lesson_id: lessonId,
    book_type: input.sourceBookType,
    title: input.sourceModuleTitle?.trim() || moduleLabel,
    sort_order: 0,
    status: input.status,
    source_document: input.sourceDocument?.trim() || "manual_input",
    page: input.page ?? null,
    notes: input.notes?.trim() || "",
    payload: {
      ...sourcePayload(input, input.status, sourceRef),
      target_module_key: moduleKey,
    },
  });

  const entry = await store.insertKnowledgeEntry({
    // 分层由调用方决定：旧版公司教材是 production_source，
    // 剑桥官方大纲/CEFR 是 authoritative_standards，真题与教辅是 reference_materials。
    layer: input.layer ?? "production_source",
    entry_type: "module_text",
    title: `${input.lessonTitle} · ${moduleLabel} · ${input.verificationMode === "verified_ocr_import" ? "已核验 OCR 来源" : input.verificationMode === "verified_outline_import" ? "已核验大纲来源" : "人工来源"}`,
    // pending 条目不把 OCR 线索放进可生产 content;确认稿才是生产正文。
    content: input.status === "confirmed" ? confirmedText : "",
    payload: sourcePayload(input, input.status, sourceRef),
    project_id: projectId,
    grade: input.grade,
    lesson_id: lessonId,
    book_type: input.sourceBookType,
    module_key: moduleKey,
    source_module_id: sourceModule.id,
    source_ref: sourceRef,
  });

  const targetIds = input.targetModuleIds?.filter(Boolean) ?? [];
  const definitions = await store.listModuleDefinitions();
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const targetBookType = input.targetBookType ?? input.sourceBookType;
  if (targetIds.length === 0) {
    const matching = definitions.find(
      (definition) => definition.book_type === targetBookType && definition.module_key === moduleKey,
    );
    if (matching) targetIds.push(matching.id);
  }
  for (const targetModuleId of [...new Set(targetIds)]) {
    if (!definitionById.has(targetModuleId)) {
      throw new KnowledgeRepositoryError(`目标模块目录不存在:${targetModuleId}`);
    }
  }
  const mappings: ModuleMappingRow[] = [];
  for (const targetModuleId of [...new Set(targetIds)]) {
    mappings.push(
      await store.insertModuleMapping({
        project_id: projectId,
        source_module_id: sourceModule.id,
        target_module_id: targetModuleId,
        mapping_type: input.mappingType?.trim() || "manual",
        priority: Math.max(0, input.mappingPriority ?? 0),
        notes: input.notes?.trim() || "",
        payload: {
          status: input.verificationMode === "verified_ocr_import" ? "confirmed_by_verified_ocr_import" : input.verificationMode === "verified_outline_import" ? "confirmed_by_verified_outline_import" : "confirmed_by_teacher",
        },
      }),
    );
  }

  return { projectId, lessonId, sourceModule, entry, mappings, deduplicated: false };
}

export async function listSourceImports(input: {
  projectId?: string;
  lessonId?: string;
  sourceBookType?: string;
  status?: SourceReviewStatus;
}) {
  return getAppStore().listSourceModules({
    projectId: input.projectId,
    lessonId: input.lessonId,
    bookType: input.sourceBookType,
    status: input.status,
  });
}

export async function confirmSourceModule(sourceModuleId: string, confirmedText: string, confirmedBy = "teacher") {
  const content = requireText(confirmedText, "人工核对后的正文");
  const store = getAppStore();
  const sourceModule = await store.getSourceModule(sourceModuleId);
  if (!sourceModule) throw new KnowledgeRepositoryError("来源模块不存在");
  const entries = await store.listKnowledgeEntries({ sourceModuleIds: [sourceModuleId] });
  const entry = entries[0];
  if (!entry) throw new KnowledgeRepositoryError("来源模块没有对应知识条目");
  const payload = {
    ...entry.payload,
    source_status: "confirmed",
    confirmed_at: new Date().toISOString(),
    confirmed_by: confirmedBy,
  };
  const updatedEntry = await store.updateKnowledgeEntry(entry.id, { content, payload });
  const updatedModule = await store.updateSourceModule(sourceModuleId, {
    status: "confirmed",
    payload: { ...sourceModule.payload, source_status: "confirmed", confirmed_at: payload.confirmed_at, confirmed_by: confirmedBy },
  });
  return { sourceModule: updatedModule, entry: updatedEntry };
}
