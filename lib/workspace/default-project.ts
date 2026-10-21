/**
 * 工作区的**默认项目**。
 *
 * 产品是单机单人工具：老师不需要按项目切换，来源、课时、版本都落在同一个工作区里。
 * 但底层的课时/书/模块仍然需要一个容器行，所以保留"项目"这一层，只是**不让老师选**。
 *
 * 历史工作区里已经有项目时**沿用它**（不搬家、不改名），没有才建一个。
 */

import { getAppStore } from "../db/store.ts";
import type { ProjectRow } from "../db/types.ts";

/** 默认项目的名字与初始年级/学期；年级与学期在生成时由界面上的选择决定，这里只是建行时的占位。 */
const DEFAULT_NAME = "我的教材";
const DEFAULT_GRADE = "L5" as const;
const DEFAULT_TERM = "winter";

export async function workspaceProject(): Promise<ProjectRow> {
  const store = getAppStore();
  const projects = await store.listProjects();
  if (projects.length > 0) {
    // 取最早创建的那个：历史数据都在它下面
    return [...projects].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!;
  }
  return store.insertProject({ name: DEFAULT_NAME, grade: DEFAULT_GRADE, term: DEFAULT_TERM });
}
