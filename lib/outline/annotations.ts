import type {
  OutlineAnnotation,
  OutlineCellLocator,
  OutlineMappingAction,
  OutlineMappingProjection,
  OutlineParseIssue,
} from "./types";

const ACTIONS = new Set<OutlineMappingAction>(["COPY", "ADAPT", "GENERATE", "HOLD_IN_SOURCE_ONLY"]);

function parseFields(value: string) {
  const fields: Record<string, string> = {};
  for (const part of value.split(/[；;]/u)) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const fieldValue = part.slice(separator + 1).trim();
    if (key && fieldValue) fields[key] = fieldValue;
  }
  return fields;
}

function statusOf(fields: Record<string, string>) {
  const status = fields.status?.toLowerCase();
  if (status === "confirmed") return "confirmed" as const;
  if (status === "disabled") return "disabled" as const;
  return "pending" as const;
}

function actionOf(fields: Record<string, string>): OutlineMappingAction | null {
  const action = fields.action?.toUpperCase() as OutlineMappingAction | undefined;
  return action && ACTIONS.has(action) ? action : null;
}

function mappingProjection(annotation: OutlineAnnotation): OutlineMappingProjection {
  const fields = annotation.fields;
  return {
    source: fields.source ?? null,
    target: fields.target ?? null,
    action: annotation.action,
    status: annotation.status,
    scope: fields.scope ?? "lesson",
    reason: fields.reason ?? null,
    note: fields.note ?? null,
    locator: annotation.locator,
    annotationRaw: annotation.raw,
    legacySourceUnit: annotation.legacySourceUnit,
  };
}

export function parseCellAnnotations(
  text: string,
  locator: OutlineCellLocator,
): { annotations: OutlineAnnotation[]; issues: OutlineParseIssue[]; mappings: OutlineMappingProjection[] } {
  const annotations: OutlineAnnotation[] = [];
  const issues: OutlineParseIssue[] = [];
  const matches = [...text.matchAll(/（([^（）]*)）/gu)];

  for (const match of matches) {
    const inner = match[1]?.trim() ?? "";
    const raw = match[0];
    if (!inner.startsWith("变更：")) {
      const legacy = inner.match(/^原\s*Unit\s*(\d+)$/iu);
      if (!legacy) continue;
      const annotation: OutlineAnnotation = {
        raw,
        kind: "legacy_source_ref",
        fields: { source: `Unit ${legacy[1]}`, status: "pending" },
        status: "pending",
        action: null,
        locator,
        errors: ["旧版 Unit 引用需要人工确认 source/target/action/status，当前仅保留为待确认提示"],
        legacySourceUnit: Number(legacy[1]),
      };
      annotations.push(annotation);
      issues.push({
        kind: "incomplete_mapping",
        message: "旧版 Unit 引用已保留，但还没有形成可执行的确认映射",
        sheet: locator.sheet,
        cell: locator.address,
        rawText: text,
      });
      continue;
    }

    const fields = parseFields(inner.slice("变更：".length));
    const errors: string[] = [];
    if (!fields.source) errors.push("缺少 source");
    if (!fields.target) errors.push("缺少 target");
    if (!fields.action) errors.push("缺少 action");
    else if (!actionOf(fields)) errors.push(`不支持的 action:${fields.action}`);
    if (fields.status && !["pending", "confirmed", "disabled"].includes(fields.status.toLowerCase())) {
      errors.push(`不支持的 status:${fields.status}`);
    }
    const annotation: OutlineAnnotation = {
      raw,
      kind: "change",
      fields,
      status: statusOf(fields),
      action: actionOf(fields),
      locator,
      errors,
    };
    annotations.push(annotation);
    if (errors.length > 0) {
      issues.push({
        kind: errors.length === 1 && errors[0].startsWith("不支持的") ? "malformed_annotation" : "incomplete_mapping",
        message: `${errors.join("；")}`,
        sheet: locator.sheet,
        cell: locator.address,
        rawText: text,
      });
    }
  }

  return {
    annotations,
    issues,
    mappings: annotations.map(mappingProjection),
  };
}

export function normalizeTargetLessonText(value: string): string {
  return value.replace(/\bUnit\s+(\d+)\b/giu, "Lesson $1");
}

export function splitLessonCell(value: string): { lessonNumber: number; title: string; targetTitle: string } | null {
  const match = value.trim().match(/^(?:Unit|Lesson|单元)\s*(\d+)\s*\n?([\s\S]*)$/iu);
  if (!match) return null;
  const lessonNumber = Number(match[1]);
  if (!Number.isInteger(lessonNumber) || lessonNumber <= 0) return null;
  const targetTitle = normalizeTargetLessonText((match[2] ?? "").trim());
  const title = targetTitle.replace(/（[^（）]*）/gu, "").trim();
  return { lessonNumber, title, targetTitle };
}

/**
 * 把用户在工作台明确确认的旧版讲次引用投影为当前 Lesson 映射。
 * 不替用户决定 COPY/ADAPT/GENERATE；未知动作保持 null，交给 Migration Plan 标记人工确认。
 */
export function confirmLegacyMapping(
  mapping: OutlineMappingProjection,
  targetLessonNumber: number,
): OutlineMappingProjection {
  if (!mapping.legacySourceUnit || !Number.isInteger(targetLessonNumber) || targetLessonNumber <= 0) return mapping;
  return {
    ...mapping,
    source: `Unit ${mapping.legacySourceUnit}`,
    target: `Lesson ${targetLessonNumber}`,
    status: "confirmed",
    reason: mapping.reason ?? "用户确认旧版讲次与新版 Lesson 的对应关系",
    note: mapping.note ?? "映射动作仍需按正式迁移规则确认",
  };
}

export function confirmLegacyAnnotation(
  annotation: OutlineAnnotation,
  targetLessonNumber: number,
): OutlineAnnotation {
  if (!annotation.legacySourceUnit || !Number.isInteger(targetLessonNumber) || targetLessonNumber <= 0) return annotation;
  return {
    ...annotation,
    fields: { ...annotation.fields, target: `Lesson ${targetLessonNumber}`, status: "confirmed" },
    status: "confirmed",
    errors: [],
  };
}

