/**
 * 审校编排：定范围 → 跑 Pipeline → 落产物。
 *
 * 三条纪律（与 OCR 侧一致）：
 * 1. 路由**立即返回**，审校在本机后台跑；关掉页面不取消任务；
 * 2. **每个阶段如实报告**——没规则、没剑桥资料都写进 manifest，不假装跑过；
 * 3. 后台任务**绝不吞异常**：失败落进任务记录，界面给可读原因。
 */

import { getAppStore } from "../db/store";
import { resolveEffectiveRules } from "../rules/resolver";
import { filterRuleSetByType } from "../rules/resolve-core";
import type { BookType, Grade } from "../db/types";
import {
  createJobRecord,
  patchJobRecord,
  readJobRecord,
  writeFindings,
  writeManifest,
} from "./jobs.ts";
import { runLlmReview } from "./llm.ts";
import {
  REVIEW_EXCLUDED_CONSTRAINTS,
  aggregateFindings,
  coverageFindings,
  executionModeOf,
  humanVisualFindings,
  issuesToFindings,
  orderFindings,
  rulePhase,
  stageReport,
  standardRefsOf,
  summarize,
  type ReviewInput,
  type ReviewTarget,
} from "./pipeline.ts";
import {
  loadStandardSections,
  selectStandardSections,
  standardFilesOf,
  standardTableOfContents,
} from "./standards.ts";
import { locateQuote } from "./anchor.ts";
import { ReviewError, type ReviewFinding, type ReviewManifest, type ReviewScope } from "./types.ts";

/** 第一批支持的范围；整课（跨四书）留到后续。 */
const SCOPES: readonly string[] = ["module", "book"];

export type StartReviewInput = {
  projectId: string;
  lessonNumber: number;
  scope: ReviewScope;
  bookType?: BookType;
  /** 模块范围时必填。 */
  moduleKey?: string;
  /** 指定版本；不给就用每个模块的**最新版本**。 */
  versionIds?: string[];
};

export function assertScope(value: unknown): ReviewScope {
  if (typeof value !== "string" || !SCOPES.includes(value)) {
    throw new ReviewError(`审校范围不受支持：${String(value)}`);
  }
  return value as ReviewScope;
}

/** 取出待审的模块版本。审校的对象永远是**已保存的版本**，不是界面上的草稿。 */
async function collectTargets(input: StartReviewInput): Promise<ReviewTarget[]> {
  const store = getAppStore();
  const lesson = await store.getLessonByNaturalKey(input.projectId, input.lessonNumber);
  if (!lesson) {
    throw new ReviewError(`Lesson ${input.lessonNumber} 还没有内容，无法审校`);
  }
  const books = await store.listBooksByLesson(lesson.id);
  const wanted = books.filter((book) =>
    input.scope === "book" ? book.book_type === input.bookType : true,
  );
  if (wanted.length === 0) {
    throw new ReviewError(
      input.bookType ? `这一课还没有「${input.bookType}」的内容` : "这一课还没有任何内容",
    );
  }

  const targets: ReviewTarget[] = [];
  for (const book of wanted) {
    const modules = (await store.listModulesByBookIds([book.id])).sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    for (const moduleRow of modules) {
      if (input.scope === "module" && moduleRow.module_key !== input.moduleKey) continue;
      const versions = await store.listModuleVersions({ moduleId: moduleRow.id });
      const chosen = input.versionIds?.length
        ? versions.find((version) => input.versionIds?.includes(version.id))
        : versions.sort((a, b) => b.version_number - a.version_number)[0];
      if (!chosen) continue;
      const content = chosen.content as { markdown?: unknown; metadata?: unknown } | null;
      const markdown = typeof content?.markdown === "string" ? content.markdown : "";
      if (!markdown.trim()) continue;
      const metadata =
        content?.metadata && typeof content.metadata === "object"
          ? (content.metadata as Record<string, unknown>)
          : {};
      const profile =
        metadata.lesson_profile && typeof metadata.lesson_profile === "object"
          ? (metadata.lesson_profile as Record<string, unknown>)
          : null;
      const field = (key: string): string | null =>
        typeof profile?.[key] === "string" ? (profile[key] as string) : null;
      targets.push({
        bookType: book.book_type,
        moduleId: moduleRow.id,
        moduleKey: moduleRow.module_key,
        moduleLabel: moduleRow.display_name || module_row_label(moduleRow),
        versionId: chosen.id,
        versionNumber: chosen.version_number,
        markdown,
        sourceRefs: Array.isArray(metadata.source_refs)
          ? metadata.source_refs.filter((item): item is string => typeof item === "string")
          : [],
        coreVocabulary: field("coreVocabulary"),
        outline: profile
          ? {
              theme: field("theme"),
              coreVocabulary: field("coreVocabulary"),
              grammar: field("grammar"),
              reading: field("reading"),
              examSkills: field("examSkills"),
            }
          : null,
      });
    }
  }
  if (targets.length === 0) {
    throw new ReviewError(
      input.scope === "module"
        ? "这个模块还没有已保存的版本，先生成或保存一版再审校"
        : "这本书还没有已保存的模块版本，先生成或保存一版再审校",
    );
  }
  return targets;
}

function module_row_label(row: { module_key: string; display_name: string }): string {
  return row.display_name || row.module_key;
}

/**
 * 规则目录的身份（来源与版本）。
 *
 * 审校标准的规则带 `sourceSkillRef`（`pet-material-review v1.0.0#LANG-001`）——
 * 记进 manifest，历史结果才能按**当时那一版**标准解释（标准的软件契约要求）。
 */
function rulesetIdentity(
  ruleSets: Array<Awaited<ReturnType<typeof resolveEffectiveRules>>>,
): { rulesetId?: string; rulesetVersion?: string } {
  for (const set of ruleSets) {
    for (const item of set.allRules) {
      const ref = item.rule.payload?.sourceSkillRef;
      if (typeof ref !== "string") continue;
      const match = /^(\S+)\s+v([0-9.]+)#/u.exec(ref);
      if (match) return { rulesetId: match[1], rulesetVersion: match[2] };
    }
  }
  return {};
}

/** 后台跑一次审校，把失败写进任务记录（不吞异常）。 */
function inBackground(jobId: string, task: () => Promise<void>): void {
  void task().catch(async (error: unknown) => {
    try {
      const current = await readJobRecord(jobId).catch(() => null);
      if (current?.status === "cancelled") return;
      await patchJobRecord(jobId, {
        status: "failed",
        stage: "失败",
        message: (error as Error)?.message ?? "未知错误",
        finishedAt: new Date().toISOString(),
      });
    } catch {
      // 连状态都写不进去：到此为止
    }
  });
}

/** 一次审校的完整流程（导出以便测试直接驱动）。 */
export async function runReviewJob(
  input: StartReviewInput,
  jobId: string,
): Promise<{ manifest: ReviewManifest; findings: ReviewFinding[] }> {
  const store = getAppStore();
  const project = await store.getProjectById(input.projectId);
  if (!project) throw new ReviewError("项目不存在");
  const lesson = await store.getLessonByNaturalKey(input.projectId, input.lessonNumber);
  if (!lesson) throw new ReviewError(`Lesson ${input.lessonNumber} 不存在`);

  await patchJobRecord(jobId, { status: "running", stage: "整理输入", startedAt: new Date().toISOString() });
  const targets = await collectTargets(input);

  // 规则按每个模块的作用域分别解析：模块级绑定可能不同，不能只解析一次套用全体。
  // 审校只看**审校规则**：生成规则的约束（词数下限、必备章节…）检查的是"生成产物该长什么样"，
  // 拿它们审一份已存在的教材只会产出噪声结论。
  const ruleSets = await Promise.all(
    targets.map((target) =>
      resolveEffectiveRules({
        projectId: input.projectId,
        lessonId: lesson.id,
        grade: project.grade as Grade,
        bookType: target.bookType,
        moduleKey: target.moduleKey,
      }).then((set) => filterRuleSetByType(set, "review")),
    ),
  );

  const findings: ReviewFinding[] = [];
  const pipeline: ReviewManifest["pipeline"] = [];

  // ① 输入整理
  pipeline.push(
    stageReport(
      "preprocessor",
      "ok",
      [],
      `待审 ${targets.length} 个模块版本；生效规则 ${ruleSets.reduce((sum, set) => sum + set.allRules.length, 0)} 条（按模块解析）`,
    ),
  );

  // ② 规则检查（逐模块用各自的规则集与大纲词汇）
  const ruleFindings = targets.flatMap((target, index) =>
    issuesToFindings(
      reviewInput(input, jobId, ruleSets[index], lesson.lesson_type, target),
      target,
    ),
  );
  findings.push(...ruleFindings);
  pipeline.push(
    stageReport(
      "rule_checks",
      ruleFindings.length >= 0 && ruleSets.every((set) => set.allRules.length > 0) ? "ok" : "skipped",
      ruleFindings,
      ruleSets.every((set) => set.allRules.length === 0)
        ? "本次没有生效规则，确定性检查没有可执行的约束"
        : `已执行；排除生成时门禁约束：${REVIEW_EXCLUDED_CONSTRAINTS.map((item) => item.key).join("、")}`,
    ),
  );

  // ③ 跨书与大纲检查：核心词汇是否仍在正文里。
  // 这条对审校特别有价值——老师编辑草稿时删掉词，生成时的检查不会再跑。
  const coverage = targets.flatMap((target, index) =>
    coverageFindings(
      reviewInput(input, jobId, ruleSets[index], lesson.lesson_type, target),
      target,
    ),
  );
  findings.push(...coverage);
  const hasOutlineVocabulary = targets.some((target) => target.coreVocabulary?.trim());
  pipeline.push(
    stageReport(
      "cross_book",
      hasOutlineVocabulary ? "ok" : "skipped",
      coverage,
      hasOutlineVocabulary
        ? "按大纲核对核心词汇是否仍在正文里"
        : "版本记录里没有大纲词汇（生成时的版本才会带上），未做覆盖核对",
    ),
  );

  // ④ 标准与剑桥依据核对：按规则引用的判据小节**精确取用**（不整本塞进 Prompt）
  const standardRefs = standardRefsOf(ruleSets.flatMap((set) => set.allRules));
  const standardFiles = standardFilesOf(standardRefs);
  const loadedSections = await loadStandardSections(standardFiles);
  const usedSections = selectStandardSections(standardRefs, loadedSections);
  const toc = standardTableOfContents(standardRefs, loadedSections);
  const standardsText = [
    ...usedSections.map((section) => `### ${section.title}（${section.file}）\n${section.content}`),
    // 引用对不上具体小节时给目录：不假装取到，也不整本塞进 Prompt
    ...toc.map(
      (item) =>
        `### ${item.file} 的目录（规则引用未定位到具体小节，以下是该材料的全部小节标题）\n` +
        item.titles.map((title) => `- ${title}`).join("\n"),
    ),
  ].join("\n\n");
  pipeline.push(
    stageReport(
      "cambridge",
      usedSections.length > 0 || toc.length > 0 ? "ok" : "skipped",
      [],
      usedSections.length > 0
        ? `按规则引用取用 ${usedSections.length} 个判据小节（${standardFiles.length} 份材料）` +
          (toc.length > 0 ? `；${toc.length} 份材料的引用未定位到具体小节，改为提供目录` : "")
        : standardRefs.length > 0
          ? "规则引用了判据材料，但工作区里没有装（审校标准基线未安装），本次未做依据核对"
          : "本次规则没有引用判据材料",
    ),
  );

  // ⑤ 人工目视类规则：文字稿没有成品页图与样式证据，按标准自己的语义如实标注
  const humanVisual = targets.flatMap((target, index) =>
    humanVisualFindings(
      reviewInput(input, jobId, ruleSets[index], lesson.lesson_type, target),
      target,
      ruleSets[index].allRules,
    ),
  );
  findings.push(...humanVisual);
  pipeline.push(
    stageReport(
      "visual",
      humanVisual.length > 0 ? "skipped" : "ok",
      humanVisual,
      humanVisual.length > 0
        ? `${humanVisual.length} 条规则需要人工目视核对（图片/样式/版式）——文字稿没有成品页证据，已如实标注`
        : "本次没有人工目视类规则",
    ),
  );

  // ⑥ 语言检查：审校标准里的语言规则（LANG-001/002 等）由模型阶段按规则原文执行，
  //    确定性的部分（banned_words 等）已在规则检查里跑过
  pipeline.push(
    stageReport("language", "ok", [], "语言类规则随模型阶段执行；确定性约束已并入规则检查"),
  );

  // ⑦ 模型审校
  let engine: ReviewManifest["engine"] = null;
  const llmFindings: ReviewFinding[] = [];
  let llmNote = "";
  const reviewable = ruleSets.some((set) => set.allRules.length > 0);
  if (!reviewable) {
    llmNote = "本次没有生效规则，未调用模型";
  } else {
    try {
      for (const [index, target] of targets.entries()) {
        const current = await readJobRecord(jobId);
        if (current.status === "cancelled") {
          llmNote = "任务已取消";
          break;
        }
        await patchJobRecord(jobId, { stage: `模型审校 ${index + 1}/${targets.length}` });
        const result = await runLlmReview({
          bookType: target.bookType,
          moduleKey: target.moduleKey,
          moduleLabel: target.moduleLabel,
          lessonNumber: input.lessonNumber,
          lessonTitle: lesson.title,
          markdown: target.markdown,
          // 只把**本次用到的**判据小节带进 Prompt（按规则引用取用）
          rules: ruleSets[index].allRules.filter(
            (rule) => executionModeOf(rule) !== "human_visual",
          ),
          standards: standardsText,
          outline: target.outline ?? null,
        });
        engine = result.engine;
        if (result.parseFailed) {
          // 解析失败**不静默**：留一条说明，让老师知道这次模型输出没用上
          llmFindings.push({
            id: `F-llm-${index + 1}`,
            ruleKey: "builtin:llm_review",
            ruleType: "review",
            stage: "llm_review",
            bookType: target.bookType,
            moduleKey: target.moduleKey,
            moduleLabel: target.moduleLabel,
            lessonNumber: input.lessonNumber,
            lessonType: lesson.lesson_type,
            versionId: target.versionId,
            versionNumber: target.versionNumber,
            anchor: { quote: "", blockIndex: null },
            message: "模型审校输出无法解析，本次没有采用它的结论。请人工复核这一课。",
            insufficientEvidence: true,
          });
          continue;
        }
        llmFindings.push(
          ...result.findings.map((item, itemIndex) => {
            const rule =
              ruleSets[index].allRules.find((entry) => entry.rule.rule_key === item.ruleKey) ?? null;
            const anchor = locateQuote(target.markdown, item.originalText);
            // **只有"模型给了引文、但那段文字不在正文里"才算未经核实**。
            //
            // 不能把"没给引文"也算进来：报告"某处缺内容"的结论本来就没有可引的原文
            // （实测"2c 没有练习内容"是真问题），一律标未核实会把真问题淹掉。
            // 没有引文的情况由界面显示中性的"无正文定位"，由老师判断。
            const unverified = item.originalText.trim() !== "" && anchor.blockIndex === null;
            // 标准的三态里「材料未提供无法核查」要**结构化**记下来，不能只留在 message 里：
            // 界面与报告要能把这类结论单独归组（它们不是教材的问题，是缺资料）。
            const cannotVerify = item.verdict === "cannot_verify";
            return {
              id: `F-llm-${index + 1}-${itemIndex + 1}`,
              ruleKey: item.ruleKey || "builtin:llm_review",
              ruleType: rule?.rule.rule_type ?? "review",
              stage: "llm_review" as const,
              bookType: target.bookType,
              moduleKey: target.moduleKey,
              moduleLabel: target.moduleLabel,
              lessonNumber: input.lessonNumber,
              lessonType: lesson.lesson_type,
              versionId: target.versionId,
              versionNumber: target.versionNumber,
              anchor,
              message: item.message,
              ...(rulePhase(rule) ? { phase: rulePhase(rule)! } : {}),
              ...(unverified ? { unverified: true } : {}),
              ...(item.evidence ? { evidence: item.evidence } : {}),
              ...(item.suggestion ? { suggestion: item.suggestion } : {}),
              ...(item.confidence != null ? { confidence: item.confidence } : {}),
              // 没写规则 ID 的条目按"资料/规则不足"处理，不冒充规则结论
              ...(item.ruleKey && !cannotVerify ? {} : { insufficientEvidence: true }),
            } satisfies ReviewFinding;
          }),
        );
      }
      llmNote = `已审 ${targets.length} 个模块`;
    } catch (error) {
      llmNote = `模型审校失败：${(error as Error).message}`;
    }
  }
  findings.push(...llmFindings);
  pipeline.push(
    stageReport(
      "llm_review",
      llmFindings.length > 0 ? "ok" : reviewable ? "failed" : "skipped",
      llmFindings,
      llmNote,
    ),
  );

  // ⑧ 汇总去重，并按**教材顺序**排（老师拿着教材从前到后核，结论也照这个顺序给）
  const merged = orderFindings(
    aggregateFindings(findings),
    targets.map((target) => `${target.bookType}/${target.moduleKey}`),
  );
  pipeline.push(
    stageReport("aggregate", "ok", merged, `合并前 ${findings.length} 条，合并后 ${merged.length} 条；按教材顺序排列`),
  );

  const now = new Date().toISOString();
  const manifest: ReviewManifest = {
    jobId,
    projectId: input.projectId,
    lessonNumber: input.lessonNumber,
    lessonTitle: lesson.title,
    lessonType: lesson.lesson_type,
    scope: input.scope,
    bookType: input.bookType ?? null,
    status: "ready",
    inputs: targets.map((target) => ({
      bookType: target.bookType,
      moduleId: target.moduleId,
      moduleKey: target.moduleKey,
      moduleLabel: target.moduleLabel,
      versionId: target.versionId,
      versionNumber: target.versionNumber,
    })),
    rules: {
      ...rulesetIdentity(ruleSets),
      reviewDate: now.slice(0, 10),
      snapshotVersion: null,
      resolvedAt: now,
      entries: dedupeRules(ruleSets),
      excluded: REVIEW_EXCLUDED_CONSTRAINTS.map((item) => ({ ruleKey: item.key, reason: item.reason })),
    },
    sources: [...new Set(targets.flatMap((target) => target.sourceRefs))],
    pipeline,
    engine,
    createdAt: now,
    updatedAt: now,
    finishedAt: now,
    stats: summarize(merged),
  };
  return { manifest, findings: merged };
}

/** 规则清单去重（多个模块解析出的同一规则只记一条）。 */
function dedupeRules(
  ruleSets: Array<Awaited<ReturnType<typeof resolveEffectiveRules>>>,
): ReviewManifest["rules"]["entries"] {
  const byKey = new Map<string, ReviewManifest["rules"]["entries"][number]>();
  for (const set of ruleSets) {
    for (const item of set.allRules) {
      if (byKey.has(item.rule.rule_key)) continue;
      const payload = item.rule.payload ?? {};
      const stringList = (value: unknown) =>
        Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
      byKey.set(item.rule.rule_key, {
        ruleKey: item.rule.rule_key,
        ruleType: item.rule.rule_type,
        isHard: item.rule.is_hard,
        versionNumber: item.version.version_number,
        scope: item.binding.scope,
        ...(typeof payload.phase === "string" ? { phase: payload.phase } : {}),
        ...(stringList(payload.reviewListRefs) ? { reviewListRefs: stringList(payload.reviewListRefs)! } : {}),
        ...(stringList(payload.standardRefs) ? { standardRefs: stringList(payload.standardRefs)! } : {}),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

/**
 * 构造一个模块的审校输入。
 *
 * 大纲信息从**版本自己的 metadata** 里读（生成时写进去的 `lesson_profile`）——
 * 审校不重新解析大纲，也不猜：版本没记录就不跑依赖大纲的检查。
 */
function reviewInput(
  input: StartReviewInput,
  jobId: string,
  ruleSet: Awaited<ReturnType<typeof resolveEffectiveRules>>,
  lessonType: ReviewManifest["lessonType"],
  target: ReviewTarget,
): ReviewInput {
  return {
    jobId,
    lessonNumber: input.lessonNumber,
    lessonType,
    ruleSet,
    coreVocabulary: target.coreVocabulary ?? null,
  };
}

/** 新建并后台启动一次审校。 */
export async function startReview(input: StartReviewInput): Promise<{ jobId: string }> {
  const scope = assertScope(input.scope);
  const record = await createJobRecord({ projectId: input.projectId, lessonNumber: input.lessonNumber });
  inBackground(record.id, async () => {
    const { manifest, findings } = await runReviewJob({ ...input, scope }, record.id);
    await writeFindings(input.projectId, input.lessonNumber, record.id, findings);
    await writeManifest(input.projectId, input.lessonNumber, manifest);
    await patchJobRecord(record.id, {
      status: "ready",
      stage: "待人工复核",
      finishedAt: new Date().toISOString(),
    });
  });
  return { jobId: record.id };
}

/** 取消：审校在进程内跑，标状态即可（后台任务在模块之间检查它）。 */
export async function cancelReview(jobId: string): Promise<void> {
  const record = await readJobRecord(jobId);
  if (record.status === "ready") throw new ReviewError("审校已完成，无需取消");
  await patchJobRecord(jobId, {
    status: "cancelled",
    stage: "已取消",
    message: "已取消审校。",
    finishedAt: new Date().toISOString(),
  });
}
