/**
 * 工作区的**默认项目**。
 *
 * 产品是单机单人工具：老师不需要按项目切换，来源、课时、版本都落在同一个工作区里。
 * 但底层的课时/书/模块仍然需要一个容器行，所以保留"项目"这一层，只是**不让老师选**。
 *
 * 历史工作区里已经有项目时**沿用它**（不搬家、不改名），没有才建一个。
 */

import { getAppStore } from "../db/store.ts";
import type { Grade, ProjectRow } from "../db/types.ts";
import { TERM_LABEL, type Term } from "../types.ts";

const DEFAULT_GRADE: Grade = "L5";
const DEFAULT_TERM = "winter";

/**
 * 工作区的默认项目。
 *
 * - 不给条件：取**最早创建**的项目（历史数据都在它下面）——识别侧用这条。
 * - 给了学期/年级：按这两个维度找；没有就建一个。**不同学期必须分开**：
 *   Lesson 编号都是从 1 开始，挤在一个项目里会互相覆盖。
 */
export async function workspaceProject(
  options: { term?: string; grade?: string } = {},
): Promise<ProjectRow> {
  const store = getAppStore();
  const projects = await store.listProjects();
  const matches = projects
    .filter((item) => (!options.term || item.term === options.term) && (!options.grade || item.grade === options.grade))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (matches.length > 0) return matches[0]!;
  // 没给条件又有项目：沿用最早的
  if (!options.term && !options.grade && projects.length > 0) {
    return [...projects].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!;
  }
  const term = options.term ?? DEFAULT_TERM;
  const grade = (options.grade ?? DEFAULT_GRADE) as Grade;
  const label = TERM_LABEL[term as Term] ?? term;
  return store.insertProject({ name: `${grade} ${label} 教材`, grade, term });
}
