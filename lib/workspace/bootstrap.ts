/**
 * 工作区初始化。
 *
 * 首次运行时建目录、写 `workspace.json`、把随包分发的 `rules/` 与 `knowledge/`
 * 基线装进工作区。之后工作区就是唯一事实源，老师改了就以工作区为准——
 * 基线只在**目标文件不存在**时补写，不覆盖老师的内容。
 *
 * 基线内容来自随包分发的 `resources/`（安装包里与程序同级）。
 * 目前 `resources/rules/` 只有投放说明：正式教材规则要等教研确认后放入，
 * 不把 `docs/drafts/` 里的初拟稿擅自转正。
 */

import { access, cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { MODULE_DIRECTORY } from "../modules/directory.ts";
import { readJson, writeJson } from "./json.ts";
import {
  EXPORTS_DIR,
  KNOWLEDGE_DIR,
  PROJECTS_DIR,
  RULES_DIR,
  WORKSPACE_FILE,
  WORKSPACE_SCHEMA_VERSION,
  appDir,
  knowledgeDir,
  moduleDefinitionsPath,
  rebuildableDirs,
  rulesDir,
  workspaceRoot,
} from "./paths.ts";

export type WorkspaceFile = {
  schema_version: number;
  /** 随包分发的基线版本；用于将来判断是否需要补装新基线。 */
  baseline_version: string;
  created_at: string;
  updated_at: string;
};

/** 随包分发的基线资源目录。打包时与程序同级。 */
export function resourcesDir(): string {
  return join(process.cwd(), "resources");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 目录不存在才从基线复制，绝不覆盖老师已有的内容。 */
/**
 * 把随包基线装进工作区。
 *
 * **按条目判断存在性，不能"目标目录已存在就整批跳过"**：`ensureWorkspace` 会先建好
 * `rules/` 与 `knowledge/`，早先按目录判断等于从不安装基线（实测工作区里连
 * `resources/rules/README.md` 都没有）。逐项复制保证：缺的补上、**老师已有的绝不覆盖**。
 */
async function seedFromResources(source: string, target: string): Promise<void> {
  if (!(await exists(source))) return;
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (await exists(to)) continue;
    await cp(from, to, { recursive: true });
  }
}

/**
 * 确保工作区存在且结构完整。幂等，可在每次取 store 前调用。
 */
export async function ensureWorkspace(): Promise<string> {
  const root = workspaceRoot();

  await mkdir(root, { recursive: true });
  for (const dir of [rulesDir(), knowledgeDir(), join(root, PROJECTS_DIR), join(root, EXPORTS_DIR), appDir()]) {
    await mkdir(dir, { recursive: true });
  }
  for (const dir of rebuildableDirs()) {
    await mkdir(dir, { recursive: true });
  }

  // 基线：只在工作区里还没有时才装。
  await seedFromResources(join(resourcesDir(), RULES_DIR), rulesDir());
  await seedFromResources(join(resourcesDir(), KNOWLEDGE_DIR), knowledgeDir());

  // 模块目录：只在工作区里还没有时写入出厂默认；之后以这份文件为准（老师可改）。
  if (!(await exists(moduleDefinitionsPath()))) {
    await writeJson(
      moduleDefinitionsPath(),
      MODULE_DIRECTORY.map((item, index) => ({
        id: `module-def-${String(index + 1).padStart(3, "0")}`,
        book_type: item.bookType,
        module_key: item.moduleKey,
        display_name: item.displayName,
        sort_order: item.sortOrder,
        description: item.status === "confirmed" ? "已确认模块目录" : "出厂默认目录，待教研确认",
        payload: {
          status: item.status,
          heading: item.heading,
          numbered: item.numbered,
          lessonTypes: item.lessonTypes,
          sourceSections: item.sourceSections,
          deterministic: item.deterministic,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    );
  }

  const now = new Date().toISOString();
  const file = join(root, WORKSPACE_FILE);
  const current = await readJson<WorkspaceFile | null>(file, null);
  if (!current) {
    await writeJson(file, {
      schema_version: WORKSPACE_SCHEMA_VERSION,
      baseline_version: BASELINE_VERSION,
      created_at: now,
      updated_at: now,
    } satisfies WorkspaceFile);
  } else if (current.schema_version !== WORKSPACE_SCHEMA_VERSION) {
    throw new Error(
      `工作区结构版本不匹配：文件是 v${current.schema_version}，程序需要 v${WORKSPACE_SCHEMA_VERSION}。` +
        `请先备份并迁移工作区，不要直接继续使用。`,
    );
  }

  return root;
}

/** 随包基线版本。基线内容更新时递增，将来据此补装。 */
export const BASELINE_VERSION = "2026-09-22";
