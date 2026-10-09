/**
 * 审校 Pipeline（`profile.md` §7.3 的八段）。
 *
 * 这个文件里都是**纯函数**：把输入（版本正文、规则集、大纲信息）变成 Finding 列表与
 * 阶段报告。I/O 与后台调度在 `jobs.ts` / `service.ts`。
 *
 * 三条纪律：
 * 1. **每个阶段如实报告**自己做了什么——做不到的写 `skipped` + 原因，不假装跑过；
 * 2. **不编造规则**：审校规则内容待教研确认（Q-CORE-014/018），这里只执行库里已有的规则；
 * 3. **不编造位置**：定位不到就留空（`anchor.blockIndex = null`）。
 */

import { runDeterministicChecks, type RuleCheckIssue } from "../rules/checks.ts";
import type { EffectiveRule, EffectiveRuleSet } from "../rules/resolve-core.ts";
import { checkVocabularyCoverage } from "../generation/coverage.ts";
import { locateQuote } from "./anchor.ts";
import type {
  ReviewAnchor,
  ReviewFinding,
  ReviewStageName,
  ReviewStageReport,
} from "./types.ts";
import type { BookType, LessonType, RuleType } from "../db/types.ts";

/** 一个待审的模块版本（正文 + 它的元数据）。 */
export type ReviewTarget = {
  bookType: BookType;
  /** 模块行 id：界面据此取这一版正文（Finding 只记书种+模块标识，不够查版本）。 */
  moduleId: string;
  moduleKey: string;
  moduleLabel: string;
  versionId: string;
  versionNumber: number;
  markdown: string;
  /** 版本 metadata 里的 `source_refs`——审校的 `require_source_annotation` 要它。 */
  sourceRefs: string[];
  /**
   * 版本 metadata 里的 `lesson_profile`（生成时写进去的大纲字段）。
   * 审校**不重新解析大纲**：版本没记录就没有，依赖它的检查如实跳过。
   */
  coreVocabulary?: string | null;
  outline?: {
    theme?: string | null;
    coreVocabulary?: string | null;
    grammar?: string | null;
    reading?: string | null;
    examSkills?: string | null;
  } | null;
};

export type ReviewInput = {
  jobId: string;
  lessonNumber: number;
  lessonType: LessonType;
  /** 该模块的生效规则集（模块级绑定可能不同，所以按模块传）。 */
  ruleSet: EffectiveRuleSet;
  /** 大纲该课的核心词汇（用于覆盖检查）；没有就不跑那条。 */
  coreVocabulary?: string | null;
};

/**
 * 生成时门禁类约束，审校侧不执行。
 *
 * `require_confirmed_source` 检查的是"生成时来源已确认"——那是生成管线的入口门禁，
 * 在审校场景里恒真、只会变成噪声。其余约束照常跑。
 */
export const REVIEW_EXCLUDED_CONSTRAINTS: ReadonlyArray<{ key: string; reason: string }> = [
  {
    key: "require_confirmed_source",
    reason: "生成时门禁（来源是否已确认），审校场景不适用",
  },
];

/**
 * 规则所属阶段与执行方式——来自审校标准迁移时写进 `RuleRow.payload` 的元数据。
 * 没写（本项目自己的草稿规则）时返回 null，按默认路径处理。
 */
export function rulePhase(rule: EffectiveRule | null): string | null {
  const phase = rule?.rule.payload?.phase;
  return typeof phase === "string" && phase.trim() ? phase.trim() : null;
}

export type ExecutionMode =
  | "deterministic_candidate"
  | "model_assisted"
  | "source_lookup"
  | "human_visual"
  | "hybrid";

/** 执行方式；没声明时按"确定性 + 模型"处理（本项目草稿规则的默认路径）。 */
export function executionModeOf(rule: EffectiveRule): ExecutionMode {
  const mode = rule.rule.payload?.executionMode;
  if (
    mode === "deterministic_candidate" ||
    mode === "model_assisted" ||
    mode === "source_lookup" ||
    mode === "human_visual" ||
    mode === "hybrid"
  ) {
    return mode;
  }
  return "hybrid";
}

/** 规则引用的判据小节（审校标准的 `standard_refs`）。 */
export function standardRefsOf(rules: readonly EffectiveRule[]): string[] {
  return [
    ...new Set(
      rules.flatMap((rule) => {
        const refs = rule.rule.payload?.standardRefs;
        return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string") : [];
      }),
    ),
  ];
}

/** 规则对应的源行映射（审校标准的 `review_list_refs`），报告里作"规则依据链接"。 */
export function reviewListRefsOf(rule: EffectiveRule | null): string[] {
  const refs = rule?.rule.payload?.reviewListRefs;
  if (!Array.isArray(refs)) return [];
  // 去重：这串直接渲染成界面上的依据链接，重复会显示两遍
  return [...new Set(refs.filter((ref): ref is string => typeof ref === "string"))];
}

/**
 * 人工目视类规则（图片、样式、版式）的如实处理。
 *
 * 工作台审的是**文字稿**：没有成品页图、没有实际样式与版式证据，
 * 这几条规则按标准自己的 `cannot_verify` 语义标注"需人工目视核对"——
 * **不假装跑过**，也不编造图片问题。
 */
export function humanVisualFindings(
  input: ReviewInput,
  target: ReviewTarget,
  rules: readonly EffectiveRule[],
): ReviewFinding[] {
  return rules
    .filter((rule) => executionModeOf(rule) === "human_visual")
    .map((rule) =>
      baseFinding(input, target, {
        ruleKey: rule.rule.rule_key,
        ruleType: rule.rule.rule_type,
        stage: "visual",
        anchor: { quote: "", blockIndex: null },
        message: `${rule.rule.display_name}：需要人工目视核对——当前工作台审的是文字稿，没有成品页图与样式证据。`,
        evidence: "标准把这条列为人工目视执行；文字稿无法替代成品页的视觉核对。",
        insufficientEvidence: true,
        ...(rulePhase(rule) ? { phase: rulePhase(rule)! } : {}),
      }),
    );
}

/** 只保留审校侧要跑的约束（去掉生成时门禁）。 */
export function filterReviewConstraints(rule: EffectiveRule): EffectiveRule {
  const constraints = { ...rule.version.constraints };
  for (const { key } of REVIEW_EXCLUDED_CONSTRAINTS) delete constraints[key];
  return { ...rule, version: { ...rule.version, constraints } };
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/** 测试用：让 Finding id 可预期。 */
export function resetFindingIds(): void {
  sequence = 0;
}

function baseFinding(
  input: ReviewInput,
  target: ReviewTarget,
  fields: {
    ruleKey: string;
    ruleType: RuleType | null;
    stage: ReviewStageName;
    anchor: ReviewAnchor;
    message: string;
    evidence?: string;
    suggestion?: string;
    sourceRefs?: string[];
    insufficientEvidence?: boolean;
    confidence?: number;
  },
): ReviewFinding {
  return {
    id: nextId("F"),
    bookType: target.bookType,
    moduleKey: target.moduleKey,
    moduleLabel: target.moduleLabel,
    lessonNumber: input.lessonNumber,
    lessonType: input.lessonType,
    versionId: target.versionId,
    versionNumber: target.versionNumber,
    ...fields,
  };
}

/** 规则检查的 issue → Finding（引文来自 issue.evidence，定位不到就留空）。 */
export function issuesToFindings(input: ReviewInput, target: ReviewTarget): ReviewFinding[] {
  const runnable = input.ruleSet.allRules.map(filterReviewConstraints);
  const issues: RuleCheckIssue[] = runnable.flatMap((rule) => {
    const single = { ...input.ruleSet, allRules: [rule], hardRules: [], scopedRules: [rule] };
    return runDeterministicChecks(single, {
      text: target.markdown,
      // 来源标注取**版本自己的** source_refs（事实数据），不替它声称"已确认"
      metadata: { sourceAnnotations: target.sourceRefs },
    });
  });

  return issues.map((issue) => {
    const rule = input.ruleSet.allRules.find((item) => item.rule.rule_key === issue.ruleKey) ?? null;
    const quote = typeof issue.evidence === "string" ? issue.evidence : "";
    return baseFinding(input, target, {
      ruleKey: issue.ruleKey,
      ruleType: rule?.rule.rule_type ?? null,
      stage: "rule_checks",
      ...(rulePhase(rule) ? { phase: rulePhase(rule)! } : {}),
      anchor: locateQuote(target.markdown, quote),
      message: issue.message,
      ...(issue.evidence ? { evidence: issue.evidence } : {}),
    });
  });
}

/** 跨书/大纲覆盖：大纲要求的核心词汇是否还在正文里。 */
export function coverageFindings(input: ReviewInput, target: ReviewTarget): ReviewFinding[] {
  if (!input.coreVocabulary?.trim()) return [];
  const issues = checkVocabularyCoverage(target.markdown, input.coreVocabulary);
  return issues.map((issue) =>
    baseFinding(input, target, {
      ruleKey: issue.ruleKey,
      ruleType: null,
      stage: "cross_book",
      // 漏词没有正文位置可言——留空，让界面显示"文档级"
      anchor: { quote: "", blockIndex: null },
      message: issue.message,
      ...(issue.evidence ? { evidence: issue.evidence } : {}),
    }),
  );
}

/**
 * 聚合去重：**同规则 + 同锚点 + 同问题**合并（`docs/REVIEW-SKILL-INTEGRATION.md` §4）。
 *
 * 合并保留先出现的那条（确定性检查在 LLM 之前跑，所以确定性的结论优先），
 * 并把后者的来源与置信度并进去，不丢信息。
 */
export function aggregateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const merged = new Map<string, ReviewFinding>();
  for (const finding of findings) {
    const key = `${finding.ruleKey}|${finding.anchor.quote}|${finding.message}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, finding);
      continue;
    }
    const sourceRefs = [...new Set([...(existing.sourceRefs ?? []), ...(finding.sourceRefs ?? [])])];
    merged.set(key, {
      ...existing,
      ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      // 证据更全的留下
      evidence: existing.evidence ?? finding.evidence,
      suggestion: existing.suggestion ?? finding.suggestion,
    });
  }
  return [...merged.values()];
}

/** 统计（报告与界面筛选都用它）。 */
export function summarize(findings: ReviewFinding[]): {
  total: number;
  byStatus: Record<"pending" | "adopt" | "ignore" | "recheck", number>;
  byBook: Record<string, number>;
  insufficientEvidence: number;
} {
  const byStatus = { pending: 0, adopt: 0, ignore: 0, recheck: 0 };
  const byBook: Record<string, number> = {};
  let insufficientEvidence = 0;
  for (const finding of findings) {
    byStatus[finding.decision?.action ?? "pending"] += 1;
    byBook[finding.bookType] = (byBook[finding.bookType] ?? 0) + 1;
    if (finding.insufficientEvidence) insufficientEvidence += 1;
  }
  return { total: findings.length, byStatus, byBook, insufficientEvidence };
}

/**
 * 按**教材顺序**排：模块（本次审校的输入顺序）→ 正文位置。
 *
 * 不做严重度分级（审校标准明确"不新增严重度字段"）。老师拿着教材从前到后核，
 * 结论也照这个顺序给——分级既不改变要做什么，又会让同一个问题在不同课上排到不同位置。
 *
 * `moduleOrder` 是本次审校的输入顺序（`<书种>/<模块标识>`）；不在其中的排在最后，
 * 免得漏掉的分组悄悄插到中间。正文位置缺失（文档级结论）的排在同模块末尾。
 */
export function orderFindings(
  findings: readonly ReviewFinding[],
  moduleOrder: readonly string[],
): ReviewFinding[] {
  const rank = new Map(moduleOrder.map((key, index) => [key, index]));
  const LAST = Number.MAX_SAFE_INTEGER;
  return [...findings].sort((a, b) => {
    const byModule =
      (rank.get(`${a.bookType}/${a.moduleKey}`) ?? LAST) -
      (rank.get(`${b.bookType}/${b.moduleKey}`) ?? LAST);
    if (byModule !== 0) return byModule;
    const byBlock =
      (a.anchor.blockIndex ?? LAST) - (b.anchor.blockIndex ?? LAST);
    if (byBlock !== 0) return byBlock;
    // 同位置的按规则 ID 定序，保证同一份输入每次排出同样的结果
    return a.ruleKey.localeCompare(b.ruleKey);
  });
}

/** 阶段报告的构造：把"做了什么/为什么没做"写清楚。 */
export function stageReport(
  name: ReviewStageName,
  status: ReviewStageReport["status"],
  findings: ReviewFinding[],
  note?: string,
): ReviewStageReport {
  return { name, status, findingCount: findings.length, ...(note ? { note } : {}) };
}

/** 按书种与模块分组（报告用）。 */
export function groupByModule(findings: ReviewFinding[]): Map<string, ReviewFinding[]> {
  const groups = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    const key = `${finding.bookType}/${finding.moduleKey}`;
    const list = groups.get(key) ?? [];
    list.push(finding);
    groups.set(key, list);
  }
  return groups;
}
