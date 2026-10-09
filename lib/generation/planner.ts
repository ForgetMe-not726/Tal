import type { EffectiveRule } from "@/lib/rules/resolve-core";
import type { RetrievedKnowledge } from "@/lib/knowledge/types";
import type { OutlineLessonProfile } from "@/lib/outline/types";

export type MigrationOperationKind = "COPY" | "ADAPT" | "GENERATE";

export type MigrationOperation = {
  kind: MigrationOperationKind;
  target: string;
  sourceRefs: string[];
  reason: string;
  requiresHumanReview: boolean;
};

export type MigrationPlan = {
  schemaVersion: 1;
  target: { moduleKey: string; moduleLabel: string };
  outline?: {
    lessonKey: string;
    outlineVersion: string | null;
    mappingReviewRequired: boolean;
    sourceCell: { sheet: string; address: string };
  };
  operations: MigrationOperation[];
  summary: { copy: number; adapt: number; generate: number };
  requiresHumanReview: boolean;
};

function requiredSections(rules: EffectiveRule[]): string[] {
  const values = rules.flatMap((rule) => {
    const candidate =
      rule.version.constraints.required_sections ?? rule.version.constraints.reading_sections_required;
    return Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string") : [];
  });
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function hasHeading(text: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "im").test(text);
}

export function buildMigrationPlan(input: {
  moduleKey: string;
  moduleLabel: string;
  entries: RetrievedKnowledge[];
  rules: EffectiveRule[];
  lessonProfile?: OutlineLessonProfile;
  outlineVersion?: string;
}): MigrationPlan {
  const mappingReviewRequired = Boolean(input.lessonProfile?.mappings.some((mapping) =>
    mapping.action !== "HOLD_IN_SOURCE_ONLY" && (mapping.status === "pending" || (mapping.status === "confirmed" && mapping.action === null)),
  ));
  const operations: MigrationOperation[] = input.entries.map((item) => ({
    kind: item.reason === "mapped_source" || item.reason === "exact_module" ? "COPY" : "ADAPT",
    target: input.moduleLabel,
    sourceRefs: [item.entry.source_ref],
    reason:
      mappingReviewRequired
        ? "来源可检索，但大纲映射仍待人工确认"
        : item.reason === "mapped_source"
          ? "沿用已确认的新旧模块映射来源"
          : item.reason === "exact_module"
            ? "沿用同模块标识的已确认来源"
            : "来源与目标模块不是精确映射，需要教师确认改编范围",
    requiresHumanReview: mappingReviewRequired || (item.reason !== "mapped_source" && item.reason !== "exact_module"),
  }));
  const outline = input.lessonProfile
    ? {
        lessonKey: input.lessonProfile.lessonKey,
        outlineVersion: input.outlineVersion ?? null,
        mappingReviewRequired,
        sourceCell: {
          sheet: input.lessonProfile.sourceCell.sheet,
          address: input.lessonProfile.sourceCell.address,
        },
      }
    : undefined;

  const combinedSource = input.entries.map((item) => item.entry.content).join("\n");
  for (const section of requiredSections(input.rules)) {
    if (!hasHeading(combinedSource, section)) {
      operations.push({
        kind: "GENERATE",
        target: section,
        sourceRefs: input.entries.map((item) => item.entry.source_ref),
        reason: "生效规则要求该结构，但确认来源中没有对应章节",
        requiresHumanReview: true,
      });
    }
  }

  const summary = operations.reduce(
    (result, operation) => {
      result[operation.kind.toLowerCase() as "copy" | "adapt" | "generate"] += 1;
      return result;
    },
    { copy: 0, adapt: 0, generate: 0 },
  );
  return {
    schemaVersion: 1,
    target: { moduleKey: input.moduleKey, moduleLabel: input.moduleLabel },
    outline,
    operations,
    summary,
    requiresHumanReview: operations.some((operation) => operation.requiresHumanReview) || mappingReviewRequired,
  };
}
