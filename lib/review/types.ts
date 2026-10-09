/**
 * 审校的稳定契约。
 *
 * 事实源是 `lessons/<lesson-NN>/review/<job-id>/` 下的三份 JSON：
 * `manifest.json`（这次审校的输入与过程）、`findings.json`（**唯一事实源**）、
 * `decisions.json`（老师的处理决定）。`report.html` 由前三项生成，可重建、只读
 * （`docs/REVIEW-SKILL-INTEGRATION.md` §4/§6、`profile.md` §7.3）。
 */

import type { BookType, LessonType, RuleType } from "@/lib/db/types";

/** 第一批支持的范围；整课（跨四书）留到后续。 */
export type ReviewScope = "module" | "book";

/** 老师的处理决定。忽略与复查只改决定，**不删除原始 Finding**。 */
export type ReviewDecisionAction = "adopt" | "ignore" | "recheck";

export type ReviewDecision = {
  action: ReviewDecisionAction;
  note?: string;
  decidedAt: string;
  decidedBy: string;
};

/**
 * Pipeline 的八个阶段（`profile.md` §7.3）。
 *
 * 每个阶段都要如实报告自己做了什么——做不到的写进 `note`，**不假装跑过**。
 */
export type ReviewStageName =
  | "preprocessor"
  | "rule_checks"
  | "cross_book"
  /** 标准与剑桥依据核对（审校标准的判据材料按引用取用）。 */
  | "cambridge"
  | "language"
  /** 人工目视类规则（图片、样式、版式）：文字稿没有成品页证据，如实标注待人工。 */
  | "visual"
  | "llm_review"
  | "aggregate";

export type ReviewStageStatus = "ok" | "skipped" | "failed";

export type ReviewStageReport = {
  name: ReviewStageName;
  status: ReviewStageStatus;
  findingCount: number;
  /** 老师看得懂的一句话：做了什么、为什么没做。 */
  note?: string;
};

/**
 * 正文锚点。
 *
 * 用**子串语义**（与 `lib/suggestions/apply.ts` 一致）：`quote` 是命中的原文片段，
 * 定位、报告引用和界面高亮都靠它。`blockIndex` 是它在正文里的块序号（用于排序与分组），
 * **定位不到就留 null**，不伪造位置。
 */
export type ReviewAnchor = {
  quote: string;
  blockIndex: number | null;
};

/**
 * 一条审校结论。
 *
 * **不带严重度**（审校标准明确"不新增严重度字段"，2026-10-09 确认）。
 * 排序与呈现都按**教材顺序**（书 → 模块 → 正文位置），老师从前到后逐条看——
 * 这才是处理审校结论的真实顺序；给每条结论评个级别既不可靠，也不改变要做什么。
 * 「这条规则是硬门槛」由规则自己的 `is_hard` 表达（报告里标"红线"），不复制到 Finding 上。
 */
export type ReviewFinding = {
  id: string;
  /** 规则 ID（`R-XX-NNN`）；内置检查用 `builtin:` 前缀。 */
  ruleKey: string;
  ruleType: RuleType | null;
  stage: ReviewStageName;
  /** 规则所属阶段（来自审校标准的 `phase`，如 language/answer/exam）；没有就不写。 */
  phase?: string;
  bookType: BookType;
  moduleKey: string;
  moduleLabel: string;
  lessonNumber: number;
  lessonType: LessonType;
  /** 被审校的版本 id——采用建议时作为 `basedOnVersionId`。 */
  versionId: string;
  versionNumber: number;
  anchor: ReviewAnchor;
  message: string;
  /** 规则依据或来源证据。 */
  evidence?: string;
  /** 建议怎么改（没有建议时留空，不写占位文字）。 */
  suggestion?: string;
  /** 来源定位（如 `legacy-sb:lesson-1:read`），供报告与后续证据视图使用。 */
  sourceRefs?: string[];
  /** 资料不足：明确说"查不了"，不编造结论。 */
  insufficientEvidence?: boolean;
  /**
   * 模型给了引文、但那段文字**在正文里找不到**（引文对不上，多半是模型看错了）。
   *
   * 实测模型会报出正文里并不存在的问题（"正文包含审校说明"之类），
   * 引文对不上就是最直接的信号。标出来让老师先看这一条，而不是把它当结论。
   */
  unverified?: boolean;
  /** 模型置信提示（只在 LLM 阶段有）。 */
  confidence?: number;
  decision?: ReviewDecision;
};

/** 一次审校的输入与过程。 */
export type ReviewManifest = {
  jobId: string;
  projectId: string;
  lessonNumber: number;
  lessonTitle: string;
  lessonType: LessonType;
  scope: ReviewScope;
  /** 单书范围时的书种；模块范围时是所审模块的书种。 */
  bookType: BookType | null;
  status: ReviewJobStatus;
  /** 输入版本清单：报告要能说清"审的是哪一版"。 */
  inputs: Array<{
    bookType: BookType;
    moduleId: string;
    moduleKey: string;
    moduleLabel: string;
    versionId: string;
    versionNumber: number;
  }>;
  /** 生效规则快照（含 rule_key / version / scope / is_hard / rule_type）。 */
  rules: {
    /** 规则目录来源与版本（公司审校标准迁移来的规则会带上，历史结果按原版本解释）。 */
    rulesetId?: string;
    rulesetVersion?: string;
    /** 审校日期（标准契约要求写入运行 metadata）。 */
    reviewDate?: string;
    snapshotVersion: number | null;
    resolvedAt: string;
    entries: Array<{
      ruleKey: string;
      ruleType: RuleType;
      isHard: boolean;
      versionNumber: number;
      scope: string;
      /** 规则阶段（审校标准迁移来的规则有）。 */
      phase?: string;
      /** 规则映射到的审校清单源行——界面据此显示"规则依据链接"。 */
      reviewListRefs?: string[];
      /** 规则引用的判据小节。 */
      standardRefs?: string[];
    }>;
    /** 明确记下这次没跑哪些规则、为什么。 */
    excluded?: Array<{ ruleKey: string; reason: string }>;
  };
  /** 已确认来源（供报告说明"依据了哪些来源"）。 */
  sources: string[];
  pipeline: ReviewStageReport[];
  engine: { provider: string; model: string } | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** 报告生成时间；空表示还没生成过。 */
  reportGeneratedAt?: string;
  stats: ReviewStats;
  warnings?: string[];
};

export type ReviewJobStatus = "queued" | "running" | "ready" | "failed" | "cancelled" | "interrupted";

export type ReviewStats = {
  total: number;
  byStatus: Record<"pending" | "adopt" | "ignore" | "recheck", number>;
  byBook: Record<string, number>;
  /** 资料不足、需要补材料才能判定的条目数。 */
  insufficientEvidence: number;
};

/** `.app/jobs/<id>.json`：在跑任务的状态（可重建，不是事实源）。 */
export type ReviewJobRecord = {
  id: string;
  projectId: string;
  lessonNumber: number;
  status: ReviewJobStatus;
  stage: string;
  message?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
};

export class ReviewError extends Error {}
