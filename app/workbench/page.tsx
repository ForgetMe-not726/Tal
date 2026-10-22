"use client";

import * as React from "react";
import { WorkbenchLeftPanel } from "@/components/workbench/WorkbenchLeftPanel";
import { WorkbenchCenter } from "@/components/workbench/WorkbenchCenter";
import {
  WorkbenchSuggestionPanel,
  type SuggestionGap,
  type SuggestionRuleRef,
} from "@/components/workbench/WorkbenchSuggestionPanel";
import {
  filterLegacyCandidatesForLesson,
  lessonSourceStats,
  sourceUnitForTargetLesson,
} from "@/lib/knowledge/legacy-markdown";
import { splitLegacyMarkdown } from "@/lib/knowledge/legacy-source";
import { missingSourceMessage, selectSourceText } from "@/lib/knowledge/source-selection";
import { BOOK_TYPES, plateLetter, plateTone } from "@/lib/mock";
import { moduleOrdinal } from "@/lib/markdown/heading-levels";
import { applySuggestionToMarkdown, type ApplyFailureReason } from "@/lib/suggestions/apply";
import type { AiDiagnosticsView, BlockCheck, ContentSuggestion, BookTypeId, ExportFormat, GeneratedBlock, LegacyLessonPackage, LegacySectionKey, LessonType, Level, ModuleDef, ModuleVersionSummary, OutlineLessonProfile, OutlineProfile, WorkbenchSuggestion } from "@/lib/types";

const TERM = "winter";
/**
 * 项目名不再是常量。
 *
 * 此前写死成"冬季教材迁移 MVP"，而「资料识别」页有自己的项目选择——
 * 两边对不上就选不到刚识别完的来源，版本也会落到另一个项目里。
 * 这里改成从工作区读项目列表，默认沿用原来的名字（迁移前后行为一致）。
 */
const DEFAULT_PROJECT_NAME = "冬季教材迁移 MVP";

type GenerationResponse = {
  markdown: string;
  version: {
    id: string;
    origin_summary?: { copy: number; adapt: number; generate: number };
  };
  context: { projectId: string; lessonId: string; moduleId: string };
  checks: BlockCheck[];
  sourceRefs?: string[];
  migrationPlan?: { requiresHumanReview: boolean; summary?: { copy: number; adapt: number; generate: number } };
  /** 本次参考的范本（知识库集合里的同模块定稿）；没有范本时为 null。 */
  exemplar?: { collectionTitle: string; lessonNumber: number; pages: [number, number] | null } | null;
};

type SaveResponse = { version: { id: string }; checks?: BlockCheck[] };
type SuggestionState = {
  blockId: string;
  versionId?: string;
  items: WorkbenchSuggestion[];
  /** 本次进 Context Pack 的规则（把规则 ID 显示成规则名）。 */
  rules: SuggestionRuleRef[];
  /** 本次资料缺口与规则冲突：老师要能看见"这次依据全不全"。 */
  gaps: SuggestionGap[];
  conflicts: Array<{ key: string; summary: string }>;
  jobId: string;
};

function makeFileName(level: Level, bookTypeId: BookTypeId, lessonNumber: number, lessonTitle: string) {
  const label = BOOK_TYPES.find((book) => book.id === bookTypeId)?.label ?? "教材";
  return `${level}-${label}-L${lessonNumber}-${lessonTitle || "未命名"}.md`;
}

/** API 已经返回解析后的模块定义（数据库 payload 覆盖过出厂默认），这里只做形状转换。 */
type ResolvedModule = {
  id: string;
  moduleKey: string;
  displayName: string;
  heading: string | null;
  sortOrder: number;
  numbered: boolean;
  lessonTypes: LessonType[];
  sourceSections: LegacySectionKey[];
  deterministic?: "objectives_table" | "objectives_lesson_page";
};

/** 书种的中文名。从 BOOK_TYPES 取，避免每处各写一份 ternary 漏掉书种。 */
function bookLabelOf(bookType: BookTypeId): string {
  return BOOK_TYPES.find((book) => book.id === bookType)?.label ?? bookType;
}

function toModuleDefs(definitions: ResolvedModule[]): ModuleDef[] {
  return [...definitions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((definition) => ({
      id: definition.id,
      moduleKey: definition.moduleKey,
      label: definition.displayName,
      heading: definition.heading,
      numbered: definition.numbered,
      lessonTypes: definition.lessonTypes,
      sourceSections: definition.sourceSections,
      deterministic: definition.deterministic,
      markdown: "",
    }));
}

export default function WorkbenchPage() {
  const [level, setLevel] = React.useState<Level>("L5");
  const [bookType, setBookType] = React.useState<BookTypeId>("knowledge");
  const [lessonType, setLessonType] = React.useState<LessonType>("regular");
  const [lessonNumber, setLessonNumber] = React.useState(1);
  const [lessonTitle, setLessonTitle] = React.useState("Fond memories");
  const [rawSourceText, setRawSourceText] = React.useState("");
  const [fileName, setFileName] = React.useState(() => makeFileName("L5", "knowledge", 1, "Fond memories"));
  const [modules, setModules] = React.useState<ModuleDef[]>([]);
  const [aiDiagnostics, setAiDiagnostics] = React.useState<AiDiagnosticsView | null>(null);
  const [outlineProfile, setOutlineProfile] = React.useState<OutlineProfile | null>(null);
  const [selectedLessonKey, setSelectedLessonKey] = React.useState<string | null>(null);
  const [outlineFileName, setOutlineFileName] = React.useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = React.useState(false);
  const [legacyPackages, setLegacyPackages] = React.useState<LegacyLessonPackage[]>([]);
  const [legacySourceFileName, setLegacySourceFileName] = React.useState<string | null>(null);
  const [blocks, setBlocks] = React.useState<GeneratedBlock[]>([]);
  const [versionHistory, setVersionHistory] = React.useState<Record<string, ModuleVersionSummary[]>>({});
  const [versionHistoryEpoch, setVersionHistoryEpoch] = React.useState(0);
  const [loadingModule, setLoadingModule] = React.useState<string | null>(null);
  const [moduleFailures, setModuleFailures] = React.useState<Record<string, string>>({});
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(null);
  const [suggestionState, setSuggestionState] = React.useState<SuggestionState | null>(null);
  const [suggestionBusy, setSuggestionBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [contextIds, setContextIds] = React.useState<{ projectId?: string; lessonId?: string }>({});
  const [toast, setToast] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string; grade: string; term: string }>>([]);
  const [projectId, setProjectId] = React.useState("");
  const [ocrSources, setOcrSources] = React.useState<Array<{ jobId: string; originalName: string; pageCount: number }>>([]);
  const projectName = projects.find((item) => item.id === projectId)?.name ?? DEFAULT_PROJECT_NAME;
  // 换了项目但新列表还没回来时，不要把上一个项目的来源显示出来
  const visibleOcrSources = projectId ? ocrSources : [];
  const requestEpoch = React.useRef(0);
  const generationAbortController = React.useRef<AbortController | null>(null);
  const blocksRef = React.useRef<GeneratedBlock[]>([]);

  const activeBlock = blocks.find((block) => block.id === selectedBlockId) ?? blocks.at(-1) ?? null;
  const selectedOutlineLesson = outlineProfile?.lessons.find((lesson) => lesson.lessonKey === selectedLessonKey) ?? null;
  const selectedSourceUnit = selectedOutlineLesson ? sourceUnitForTargetLesson(selectedOutlineLesson) : null;
  const legacyCandidates = filterLegacyCandidatesForLesson(legacyPackages, selectedSourceUnit);
  // 编号顺序来自模块目录（已按课型过滤、按 sortOrder 排好）。
  const numberedKeys = modules.filter((item) => item.numbered).map((item) => item.moduleKey ?? item.id);
  // 只有"当前模块 + 版本一致"时才显示建议；换了模块或正文变版就自动失效
  const activeSuggestionState =
    activeBlock &&
    suggestionState &&
    suggestionState.blockId === activeBlock.id &&
    suggestionState.versionId === activeBlock.versionId
      ? suggestionState
      : null;
  const suggestions = activeSuggestionState?.items ?? [];
  const visibleSuggestionMeta = {
    rules: activeSuggestionState?.rules ?? [],
    gaps: activeSuggestionState?.gaps ?? [],
    conflicts: activeSuggestionState?.conflicts ?? [],
  };

  React.useEffect(() => {
    let active = true;
    // 课型决定挂哪些模块（学生用书复习课没有 explore/read），由服务端按目录过滤。
    void fetch(`/api/module-definitions?bookType=${bookType}&lessonType=${lessonType}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          modules?: ResolvedModule[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "模块目录加载失败");
        if (active) {
          setModules(toModuleDefs(data.modules ?? []));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setToast((error as Error).message);
        }
      });
    return () => {
      active = false;
    };
  }, [bookType, lessonType]);

  React.useEffect(() => {
    let active = true;
    void fetch("/api/ai/diagnostics", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as AiDiagnosticsView;
        if (active) setAiDiagnostics(data);
      })
      .catch(() => {
        if (active) setAiDiagnostics(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  React.useEffect(() => {
    const moduleId = activeBlock?.moduleId;
    if (!moduleId) return;
    let active = true;
    void fetch(`/api/modules/versions?moduleId=${encodeURIComponent(moduleId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { versions?: ModuleVersionSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "版本历史加载失败");
        if (active) setVersionHistory((previous) => ({ ...previous, [moduleId]: data.versions ?? [] }));
      })
      .catch((error: unknown) => {
        if (active) setToast((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [activeBlock?.moduleId, versionHistoryEpoch]);

  // 默认项目：老师不需要选项目。**由服务端给**，与识别侧用同一条规则
  // （最早创建的那个）——按列表顺序猜会落到另一个项目，课时和版本就分家了。
  React.useEffect(() => {
    let active = true;
    void fetch("/api/projects/default", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as {
          project?: { id: string; name: string; grade: string; term: string };
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "默认项目加载失败");
        if (!active || !data.project) return;
        setProjects([data.project]);
        setProjectId((current) => current || data.project!.id);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // 本项目、本书种下**已确认**的 OCR 来源（资料识别页确认过的）
  React.useEffect(() => {
    // 没选项目时不清 state（effect 里同步 setState 会触发级联渲染），
    // 改用下面的派生值把它挡住。
    if (!projectId) return;
    let active = true;
    // 来源按整个工作区列：老师不需要按项目切换
    void fetch(`/api/ocr/sources?bookType=${bookType}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          sources?: Array<{ jobId: string; originalName: string; pageCount: number }>;
        };
        if (active) setOcrSources(data.sources ?? []);
      })
      .catch(() => active && setOcrSources([]));
    return () => {
      active = false;
    };
  }, [projectId, bookType]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  function resetDocument() {
    requestEpoch.current += 1;
    generationAbortController.current?.abort();
    generationAbortController.current = null;
    setBlocks([]);
    setVersionHistory({});
    setVersionHistoryEpoch(0);
    setRawSourceText("");
    setSelectedBlockId(null);
    setSuggestionState(null);
    setContextIds({});
    setLoadingModule(null);
  }

  function updateFileName(
    nextLevel = level,
    nextBookType = bookType,
    nextLessonNumber = lessonNumber,
    nextTitle = lessonTitle,
  ) {
    setFileName(makeFileName(nextLevel, nextBookType, nextLessonNumber, nextTitle));
  }

  function applyOutlineLesson(lesson: OutlineLessonProfile) {
    resetDocument();
    setSelectedLessonKey(lesson.lessonKey);
    setLessonNumber(lesson.lessonNumber);
    setLessonTitle(lesson.title || lesson.targetTitle || `Lesson ${lesson.lessonNumber}`);
    updateFileName(level, bookType, lesson.lessonNumber, lesson.title || lesson.targetTitle);
  }

  async function handleLegacyMarkdownFileChange(file: File) {
    if (saving) return;
    try {
      const text = await file.text();
      // 按书种选解析器：学生用书是 UNIT + Hello X，知识清单是 第N讲 + 词汇复习。
      const packages = splitLegacyMarkdown(text, bookType);
      setLegacySourceFileName(file.name);
      setLegacyPackages(packages);
      setRawSourceText(text);
      const candidateCount = packages.reduce((total, item) => total + item.candidates.length, 0);
      const bookLabel = bookLabelOf(bookType);
      setToast(
        candidateCount > 0
          ? `已读取 ${packages.length} 个旧版讲次、${candidateCount} 个来源块（按${bookLabel}栏目解析）`
          : `没有识别到旧版${bookLabel}栏目；请确认上传的是对应书种的 OCR`,
      );
    } catch (error) {
      setLegacyPackages([]);
      setToast(`旧版来源读取失败：${(error as Error).message}`);
    }
  }

  /**
   * 从资料库选一份**已确认**的 OCR 来源。
   *
   * 走与上传文件**完全相同**的解析路径（`splitLegacyMarkdown`），不新增第二条代码路径——
   * 区别只是正文来自工作区里的 `content.md` 而不是本地文件。
   */
  async function handleSelectOcrSource(jobId: string) {
    if (saving) return;
    try {
      const response = await fetch(`/api/ocr/${jobId}/raw/content.md`, { cache: "no-store" });
      if (!response.ok) throw new Error("读取来源正文失败");
      const text = await response.text();
      const packages = splitLegacyMarkdown(text, bookType);
      const source = visibleOcrSources.find((item) => item.jobId === jobId);
      setLegacySourceFileName(source ? `${source.originalName}（资料库）` : "资料库来源");
      setLegacyPackages(packages);
      setRawSourceText(text);
      const candidateCount = packages.reduce((total, item) => total + item.candidates.length, 0);
      setToast(
        candidateCount > 0
          ? `已从资料库读取 ${packages.length} 个旧版讲次、${candidateCount} 个来源块`
          : "这份来源没有切出可用的栏目，请回「资料识别」核对",
      );
    } catch (error) {
      setToast((error as Error).message);
    }
  }

  async function handleOutlineFileChange(file: File) {
    if (saving || outlineLoading) return;
    requestEpoch.current += 1;
    generationAbortController.current?.abort();
    generationAbortController.current = null;
    setLoadingModule(null);
    setOutlineLoading(true);
    setOutlineProfile(null);
    setSelectedLessonKey(null);
    setLegacyPackages([]);
    setLegacySourceFileName(null);
    setOutlineFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/outline/ingest", { method: "POST", body: form });
      const data = (await response.json()) as { profile?: OutlineProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error ?? "大纲导入失败");
      setOutlineProfile(data.profile);
      const firstLesson = data.profile.lessons[0];
      if (firstLesson) applyOutlineLesson(firstLesson);
      else setToast("大纲已读取，但没有可选择的 Lesson");
      if (data.profile.issues.length > 0) {
        setToast(`大纲已导入；有 ${data.profile.issues.length} 项单元格待确认`);
      }
    } catch (error) {
      setOutlineProfile(null);
      setSelectedLessonKey(null);
      setToast((error as Error).message);
    } finally {
      setOutlineLoading(false);
    }
  }

  function handleOutlineLessonChange(lessonKey: string) {
    const lesson = outlineProfile?.lessons.find((item) => item.lessonKey === lessonKey);
    if (lesson) applyOutlineLesson(lesson);
  }

  function handleLevelChange(next: Level) {
    if (saving) return;
    if (next !== level) {
      resetDocument();
      setSelectedLessonKey(null);
    }
    setLevel(next);
    updateFileName(next);
  }

  function handleLessonNumberChange(next: number) {
    if (saving) return;
    if (next !== lessonNumber) {
      resetDocument();
      setSelectedLessonKey(null);
    }
    setLessonNumber(next);
    updateFileName(level, bookType, next);
  }

  function handleLessonTitleChange(next: string) {
    if (saving) return;
    if (next !== lessonTitle) {
      resetDocument();
      setSelectedLessonKey(null);
    }
    setLessonTitle(next);
    updateFileName(level, bookType, lessonNumber, next);
  }

  function handleBookTypeChange(next: BookTypeId) {
    if (saving) return;
    if (next !== bookType) resetDocument();
    setModules([]);
    setBookType(next);
    updateFileName(level, next);
  }

  function handleLessonTypeChange(next: LessonType) {
    if (saving) return;
    // 课型变了模块集合也变（复习课没有 explore/read），已生成的正文不再对应当前结构。
    if (next !== lessonType) resetDocument();
    setLessonType(next);
  }

  /**
   * 该模块要用的旧版来源文本。
   *
   * 取哪些栏目由**模块目录**决定（`sourceSections`），不在这里按 moduleKey 硬编码——
   * 同一个 `lets_say` 在知识清单取「词汇复习」、在学生用书取「Hello Vocabulary」。
   */
  function sourceTextForModule(moduleKey: string): string | null {
    return selectSourceText({
      module: modules.find((item) => (item.moduleKey ?? item.id) === moduleKey),
      candidates: legacyCandidates,
      outlineLesson: selectedOutlineLesson,
      hasLegacyPackages: legacyPackages.length > 0,
      rawSourceText,
    });
  }

  async function generateOneModule(
    module: ModuleDef,
    controller: AbortController,
    epoch: number,
  ): Promise<{ block: GeneratedBlock; warnings: number; exemplar?: GenerationResponse["exemplar"] } | null> {
    const moduleKey = module.moduleKey ?? module.id;
    const sourceText = sourceTextForModule(moduleKey);
    if (!sourceText) {
      throw new Error(
        missingSourceMessage({
          moduleLabel: module.label,
          sourceLessonNumber: selectedSourceUnit,
          stats: lessonSourceStats(legacyPackages, selectedSourceUnit),
        }),
      );
    }
    const index = modules.findIndex((item) => item.id === module.id);
    const response = await fetch("/api/generate", {
      signal: controller.signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectName,
        projectId: projectId || undefined,
        grade: level,
        term: TERM,
        lessonNumber,
        lessonTitle,
        bookType,
        sourceBookType: bookType,
        moduleKey,
        moduleLabel: module.label,
        lessonType,
        sourceText,
        sourceRawText: rawSourceText,
        sourceConfirmed: true,
        // 确定性模块的来源是大纲，其余来自旧版 OCR——按目录的 deterministic 标记判断，
        // 不写死模块标识（学生用书的课时目标也叫 learning_objectives，但同属确定性模块）。
        sourceVerificationMode: module.deterministic ? "verified_outline_import" : "verified_ocr_import",
        sourceDocument: legacySourceFileName,
        lessonProfile: selectedOutlineLesson,
        outlineVersion: outlineProfile?.source.outlineVersion,
      }),
    });
    const data = (await response.json()) as GenerationResponse & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "生成失败");
    if (epoch !== requestEpoch.current) return null;
    return {
      warnings: data.checks.length,
      exemplar: data.exemplar,
      block: {
        id: `${module.id}-${data.version.id}`,
        moduleLabel: module.label,
        moduleKey,
        moduleId: data.context.moduleId,
        versionId: data.version.id,
        savedMarkdown: data.markdown,
        markdown: data.markdown,
        checks: data.checks,
        originSummary: data.migrationPlan?.summary ?? data.version.origin_summary,
        sourceRefs: data.sourceRefs,
        migrationPlan: data.migrationPlan,
        seq: blocks.length + 1,
        bookTypeId: bookType,
        tone: plateTone(index),
        letter: plateLetter(index),
      },
    };
  }

  /** 生成单个模块；重复点击同一模块会追加一个新版本供对比。 */
  async function handleGenerateOne(module: ModuleDef) {
    if (loadingModule || saving) return;
    if (!selectedOutlineLesson) {
      setToast("请先导入部门大纲并选择目标 Lesson");
      return;
    }
    // 课时目标只来自大纲：由 deterministic 标记，不依赖旧版来源，也不需要先导入 OCR。
    const fromOutlineOnly = Boolean(module.deterministic);
    const bookLabel = bookLabelOf(bookType);
    if (!fromOutlineOnly && legacyPackages.length === 0) {
      setToast(`请先导入旧版${bookLabel} OCR`);
      return;
    }
    if (!fromOutlineOnly && legacyCandidates.length === 0) {
      const unit = sourceUnitForTargetLesson(selectedOutlineLesson);
      setToast(
        unit
          ? missingSourceMessage({
              moduleLabel: module.label,
              sourceLessonNumber: unit,
              stats: lessonSourceStats(legacyPackages, unit),
            })
          : "当前 Lesson 没有可用的旧版来源",
      );
      return;
    }
    const epoch = requestEpoch.current;
    const controller = new AbortController();
    generationAbortController.current = controller;
    setModuleFailures((previous) => {
      const next = { ...previous };
      delete next[module.id];
      return next;
    });
    setLoadingModule(module.id);
    try {
      const result = await generateOneModule(module, controller, epoch);
      if (!result || epoch !== requestEpoch.current) return;
      setBlocks((previous) => [...previous, { ...result.block, seq: previous.length + 1 }]);
      setSelectedBlockId(result.block.id);
      setSuggestionState(null);
      const exemplarNote = result.exemplar
        ? `（参考范本：${result.exemplar.collectionTitle} · Lesson ${result.exemplar.lessonNumber}${
            result.exemplar.pages ? ` p.${result.exemplar.pages[0] + 1}–${result.exemplar.pages[1] + 1}` : ""
          }）`
        : "";
      setToast(
        result.warnings > 0
          ? `「${module.label}」已生成${exemplarNote}；发现 ${result.warnings} 个检查问题`
          : `「${module.label}」已生成${exemplarNote}`,
      );
    } catch (error) {
      if (epoch !== requestEpoch.current) return;
      const message = (error as Error).message;
      setModuleFailures((previous) => ({ ...previous, [module.id]: message }));
      setToast(message);
    } finally {
      if (generationAbortController.current === controller) generationAbortController.current = null;
      setLoadingModule(null);
    }
  }

  function handleBlockChange(id: string, markdown: string) {
    setBlocks((previous) => previous.map((block) => (block.id === id ? { ...block, markdown } : block)));
    if (suggestionState?.blockId === id) setSuggestionState(null);
  }

  function handleRestoreVersion(blockId: string, version: ModuleVersionSummary) {
    const markdown = typeof version.content?.markdown === "string" ? version.content.markdown : "";
    if (!markdown) {
      setToast("该历史版本没有可恢复的 Markdown 正文");
      return;
    }
    setBlocks((previous) => previous.map((block) => block.id === blockId ? { ...block, markdown } : block));
    setSuggestionState(null);
    setToast(`已将 v${version.version_number} 放入编辑草稿；保存后生成新版本`);
  }

  async function handleSave() {
    if (saving) return;
    const dirtyBlocks = blocks.filter((block) => block.markdown !== block.savedMarkdown);
    if (dirtyBlocks.length === 0) {
      setToast("没有待保存的正文修改");
      return;
    }
    const epoch = requestEpoch.current;
    const requestContext = { level, bookType, lessonNumber, lessonTitle, lessonType, contextIds };
    setSaving(true);
    let savedCount = 0;
    try {
      for (const block of dirtyBlocks) {
        const response = await fetch("/api/modules/versions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectName,
            projectId: requestContext.contextIds.projectId,
            lessonId: requestContext.contextIds.lessonId,
            grade: requestContext.level,
            term: TERM,
            lessonNumber: requestContext.lessonNumber,
            lessonTitle: requestContext.lessonTitle,
            bookType: requestContext.bookType,
            moduleKey: block.moduleKey ?? block.id,
            moduleLabel: block.moduleLabel,
            lessonType: requestContext.lessonType,
            markdown: block.markdown,
            basedOnVersionId: block.versionId,
            sourceDocument: legacySourceFileName,
            lessonProfile: selectedOutlineLesson,
            outlineVersion: outlineProfile?.source.outlineVersion,
          }),
        });
        const data = (await response.json()) as SaveResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "保存失败");
        savedCount += 1;
        setBlocks((previous) => previous.map((item) =>
          item.id === block.id
            ? { ...item, versionId: data.version.id, savedMarkdown: item.markdown, checks: data.checks ?? item.checks }
            : item,
        ));
      }
      if (epoch === requestEpoch.current) {
        setVersionHistoryEpoch((value) => value + 1);
        setToast(`已保存 ${savedCount} 个新版本`);
      }
    } catch (error) {
      setToast(`${(error as Error).message}；已成功保存 ${savedCount} 个版本`);
    } finally {
      setSaving(false);
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport(format: ExportFormat) {
    if (blocks.length === 0) {
      setToast("正文为空，暂不能导出");
      return;
    }

    if (format === "markdown") {
      const content = [
        `# ${fileName.replace(/\.md$/, "")}`,
        ...blocks.map((block) => `## ${block.moduleLabel}\n\n${block.markdown}`),
      ].join("\n\n");
      downloadBlob(new Blob([content], { type: "text/markdown;charset=utf-8" }), fileName);
      setToast("已导出 Markdown");
      return;
    }

    try {
      const response = await fetch("/api/export/docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName,
          title: `Lesson ${lessonNumber}${lessonTitle ? ` ${lessonTitle}` : ""}`,
          blocks: blocks.map((block) => {
            const definition = modules.find(
              (item) => (item.moduleKey ?? item.id) === (block.moduleKey ?? block.id),
            );
            return {
              moduleKey: block.moduleKey,
              moduleLabel: block.moduleLabel,
              bookType,
              heading: definition?.heading ?? null,
              ordinal: moduleOrdinal(block.moduleKey, numberedKeys),
              markdown: block.markdown,
            };
          }),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Word 导出失败");
      }
      downloadBlob(await response.blob(), `${fileName.replace(/\.(md|markdown)$/i, "")}.docx`);
      setToast("已导出 Word 文档");
    } catch (error) {
      setToast((error as Error).message);
    }
  }

  async function handleGenerateSuggestions(instruction: string) {
    if (!activeBlock || suggestionBusy || saving) return;
    const target = { blockId: activeBlock.id, versionId: activeBlock.versionId, markdown: activeBlock.markdown };
    const epoch = requestEpoch.current;
    setSuggestionBusy(true);
    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: target.markdown,
          instruction,
          grade: level,
          bookType,
          moduleKey: activeBlock.moduleKey ?? activeBlock.id,
          moduleLabel: activeBlock.moduleLabel,
          projectId: contextIds.projectId,
          lessonId: contextIds.lessonId,
          lessonNumber,
          lessonTitle,
          // 版本号让服务端能取到本课目标与来源证据
          versionId: target.versionId,
        }),
      });
      const data = (await response.json()) as {
        jobId?: string;
        suggestions?: ContentSuggestion[];
        rules?: SuggestionRuleRef[];
        gaps?: SuggestionGap[];
        conflicts?: Array<{ key: string; summary: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "建议生成失败");
      const current = blocksRef.current.find((block) => block.id === target.blockId);
      if (epoch !== requestEpoch.current || !current || current.versionId !== target.versionId || current.markdown !== target.markdown) {
        setToast("正文版本已变化，已丢弃过期建议");
        return;
      }
      setSuggestionState({
        ...target,
        items: (data.suggestions ?? []).map((item) => ({ ...item, status: "pending" as const })),
        rules: data.rules ?? [],
        gaps: data.gaps ?? [],
        conflicts: data.conflicts ?? [],
        jobId: data.jobId ?? "",
      });
      setToast(`已生成 ${data.suggestions?.length ?? 0} 条建议`);
    } catch (error) {
      if (epoch === requestEpoch.current) setToast((error as Error).message);
    } finally {
      setSuggestionBusy(false);
    }
  }

  function handleApplySuggestion(suggestion: ContentSuggestion) {
    if (!activeBlock || !suggestionState || suggestionState.blockId !== activeBlock.id || suggestionState.versionId !== activeBlock.versionId) {
      setToast("建议已过期，请针对当前正文重新生成");
      return;
    }
    const result = applySuggestionToMarkdown(activeBlock.markdown, suggestion);
    if (!result.changed) {
      const messages: Record<ApplyFailureReason, string> = {
        no_anchor: "该建议没有可定位的原文，只能人工参考",
        anchor_missing: "正文已变化，未找到建议中的原文；建议仍保留",
        no_replacement: "建议没有替换内容；建议仍保留",
        unchanged: "建议未改变正文；建议仍保留",
      };
      setToast(messages[result.reason]);
      return;
    }
    setBlocks((previous) => previous.map((block) => block.id === activeBlock.id ? { ...block, markdown: result.markdown } : block));
    // 采用后**保留**条目并标状态：老师要能回看自己处理了什么（原文→建议就在卡片上对照）
    setSuggestionState((previous) =>
      previous
        ? { ...previous, items: previous.items.map((item) => item.id === suggestion.id ? { ...item, status: "adopted" as const } : item) }
        : previous,
    );
    setToast("建议已应用到编辑草稿，请保存为新版本");
  }

  return (
    <div className="flex h-screen min-w-0 flex-1">
      <WorkbenchLeftPanel
        level={level}
        lessonNumber={lessonNumber}
        lessonTitle={lessonTitle}
        bookType={bookType}
        lessonType={lessonType}
        aiDiagnostics={aiDiagnostics}
        outlineProfile={outlineProfile}
        selectedOutlineLesson={selectedOutlineLesson}
        selectedLessonKey={selectedLessonKey}
        outlineFileName={outlineFileName}
        outlineLoading={outlineLoading}
        modules={modules}
        blocks={blocks}
        loadingModule={loadingModule}
        failures={moduleFailures}
        ocrSources={visibleOcrSources}
        onSelectOcrSource={(jobId) => void handleSelectOcrSource(jobId)}
        onOutlineFileChange={(file) => void handleOutlineFileChange(file)}
        onOutlineLessonChange={handleOutlineLessonChange}
        onLegacyMarkdownFileChange={(file) => void handleLegacyMarkdownFileChange(file)}
        onLevelChange={handleLevelChange}
        onLessonNumberChange={handleLessonNumberChange}
        onLessonTitleChange={handleLessonTitleChange}
        onBookTypeChange={handleBookTypeChange}
        onLessonTypeChange={handleLessonTypeChange}
        onGenerateModule={(module) => void handleGenerateOne(module)}
      />
      <WorkbenchCenter
        fileName={fileName}
        lessonNumber={lessonNumber}
        lessonTitle={lessonTitle}
        blocks={blocks}
        loadingModule={loadingModule}
        modules={modules}
        selectedBlockId={selectedBlockId}
        editingDisabled={saving}
        onRename={setFileName}
        onBlockChange={handleBlockChange}
        versionHistory={versionHistory}
        onRestoreVersion={handleRestoreVersion}
        onSelectBlock={(id) => {
          setSelectedBlockId(id);
          if (suggestionState?.blockId !== id) setSuggestionState(null);
        }}
        onSave={() => void handleSave()}
        onExport={(format) => void handleExport(format)}
      />
      <WorkbenchSuggestionPanel
        block={activeBlock}
        suggestions={suggestions}
        rules={visibleSuggestionMeta.rules}
        gaps={visibleSuggestionMeta.gaps}
        conflicts={visibleSuggestionMeta.conflicts}
        busy={suggestionBusy || saving}
        onGenerate={(instruction) => void handleGenerateSuggestions(instruction)}
        onApply={handleApplySuggestion}
        onDismiss={(id) =>
          setSuggestionState((previous) =>
            previous
              ? { ...previous, items: previous.items.map((item) => item.id === id ? { ...item, status: "ignored" as const } : item) }
              : previous,
          )
        }
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-chrome px-4 py-2 text-sm text-paper shadow-paper animate-in fade-in-0 zoom-in-95">
          {toast}
        </div>
      )}
    </div>
  );
}
