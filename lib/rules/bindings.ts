import { getAppStore } from "@/lib/db/store";
import type { BookType, Grade, RuleBindingRow, RuleScope } from "@/lib/db/types";
import { RuleServiceError } from "@/lib/rules/service";

export type RuleBindingInput = {
  scope: RuleScope;
  projectId?: string | null;
  grade?: string | null;
  bookType?: string | null;
  moduleKey?: string | null;
  lessonId?: string | null;
};

const GRADES: readonly Grade[] = ["L1", "L2", "L3", "L4", "L5", "L6"];
const BOOK_TYPES: readonly BookType[] = ["student", "workbook", "knowledge", "vocab"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireValue(value: string | null | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new RuleServiceError(`${label}不能为空`);
  return normalized;
}

function requireUuid(value: string | null | undefined, label: string): string {
  const normalized = requireValue(value, label);
  if (!UUID_RE.test(normalized)) throw new RuleServiceError(`${label}格式不正确`);
  return normalized;
}

function normalizeInput(input: RuleBindingInput) {
  const base = {
    scope: input.scope,
    project_id: null as string | null,
    grade: null as string | null,
    book_type: null as string | null,
    module_key: null as string | null,
    lesson_id: null as string | null,
  };

  switch (input.scope) {
    case "global":
      return base;
    case "project":
      return { ...base, project_id: requireUuid(input.projectId, "项目 ID") };
    case "grade": {
      const grade = requireValue(input.grade, "年级");
      if (!GRADES.includes(grade as Grade)) throw new RuleServiceError("年级必须是 L1-L6");
      return { ...base, grade };
    }
    case "book": {
      const bookType = requireValue(input.bookType, "书种");
      if (!BOOK_TYPES.includes(bookType as BookType)) {
        throw new RuleServiceError("书种必须是 student、workbook、knowledge 或 vocab");
      }
      return { ...base, book_type: bookType };
    }
    case "module":
      return { ...base, module_key: requireValue(input.moduleKey, "模块标识") };
    case "lesson":
      return { ...base, lesson_id: requireUuid(input.lessonId, "Lesson ID") };
    default:
      throw new RuleServiceError("不支持的规则作用域");
  }
}

export async function listRuleBindings(ruleId: string): Promise<RuleBindingRow[]> {
  try {
    return await getAppStore().listRuleBindings(ruleId);
  } catch (error) {
    throw new RuleServiceError(`读取规则绑定失败:${(error as Error).message}`);
  }
}

export async function createRuleBinding(ruleId: string, input: RuleBindingInput): Promise<RuleBindingRow> {
  const values = normalizeInput(input);
  try {
    return await getAppStore().insertRuleBinding({ rule_id: ruleId, ...values });
  } catch (error) {
    const message = (error as Error).message;
    if (/duplicate|重复|相同作用域/i.test(message)) {
      throw new RuleServiceError("该规则已经绑定到相同作用域,无需重复添加");
    }
    throw new RuleServiceError(`创建规则绑定失败:${message}`);
  }
}

export async function deleteRuleBinding(ruleId: string, bindingId: string): Promise<void> {
  try {
    const deleted = await getAppStore().deleteRuleBinding(ruleId, bindingId);
    if (!deleted) throw new RuleServiceError("规则绑定不存在");
  } catch (error) {
    if (error instanceof RuleServiceError) throw error;
    throw new RuleServiceError(`删除规则绑定失败:${(error as Error).message}`);
  }
}
