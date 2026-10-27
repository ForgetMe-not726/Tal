/**
 * 工作区布局迁移。
 *
 * 2026-10-27 需求方确认：工作区不再放用户文档目录，而是**安装目录下的 `document/`**，
 * 里面分 `rules/`（规则库）、`knowledge/`（资料库）、`ocr/`（OCR 内容）。
 *
 * 迁移只在默认工作区上做（显式设置了 `AI_TEACHING_WORKSPACE` 的测试/多工作区不动）：
 * 1. 旧 `~/Documents/AI教材工作台` → `<安装目录>/document`：整体复制、校验、**删除旧目录**；
 * 2. 2026-10-23 布局的 `<root>/sources/ocr/*` → `<root>/ocr/*`（资料库提到顶层）。
 *
 * 数据安全优先：校验不过就保留旧目录并抛出可读错误，绝不静默丢数据。
 */

import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultWorkspaceRoot, installRoot, legacyWorkspaceRoot, OCR_DIR } from "./paths.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDir(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

/** 复制完成后逐项核对顶层条目，确认没有少东西才允许删旧目录。 */
async function verifyCopy(source: string, target: string): Promise<void> {
  const entries = await readdir(source);
  const missing: string[] = [];
  for (const entry of entries) {
    if (!(await exists(join(target, entry)))) missing.push(entry);
  }
  if (missing.length > 0) {
    throw new Error(
      `旧工作区复制不完整（缺 ${missing.slice(0, 5).join("、")}${missing.length > 5 ? " 等" : ""}）。` +
        `旧目录已保留，请检查磁盘空间或权限后重试。`,
    );
  }
}

/**
 * 把 `sources/ocr/*` 合并到顶层 `ocr/`。
 *
 * 幂等：已经迁移过（顶层 `ocr/` 已存在同名目录）就跳过；两边同名时**不覆盖**，
 * 抛错让老师知道有重复，避免悄悄丢一份识别结果。
 */
async function normalizeOcrLayout(root: string): Promise<void> {
  const legacy = join(root, "sources", "ocr");
  if (!(await exists(legacy))) return;
  const target = join(root, OCR_DIR);
  await mkdir(target, { recursive: true });
  const conflicts: string[] = [];
  for (const entry of await readdir(legacy)) {
    const from = join(legacy, entry);
    const to = join(target, entry);
    if (await exists(to)) {
      conflicts.push(entry);
      continue;
    }
    await rename(from, to);
  }
  if (conflicts.length > 0) {
    throw new Error(
      `资料库迁移有重名目录：${conflicts.slice(0, 5).join("、")}。` +
        `旧目录（${legacy}）已保留，请人工确认后再删。`,
    );
  }
  // 搬迁后清掉空的 sources/ocr 与 sources；里面还有原件等其他内容就保留
  if (await isEmptyDir(legacy)) {
    await rm(legacy, { recursive: true, force: true });
  }
  if (await isEmptyDir(join(root, "sources"))) {
    await rm(join(root, "sources"), { recursive: true, force: true });
  }
}

export type WorkspaceMigrationResult = "skipped" | "migrated";

/**
 * 一次性布局迁移。参数显式传入，便于测试。
 *
 * - `root` 已有内容：视为已在用，跳过旧目录迁移（只做 OCR 目录归位）；
 * - `legacyRoot` 不存在：没有可迁移的旧工作区；
 * - 复制或校验失败：抛错，旧目录保留。
 */
export async function migrateWorkspaceLayout(input: {
  root: string;
  legacyRoot: string;
  installRoot: string;
}): Promise<WorkspaceMigrationResult> {
  let migrated = false;
  const rootReady = (await exists(input.root)) && !(await isEmptyDir(input.root));
  if (!rootReady && (await exists(input.legacyRoot))) {
    try {
      await mkdir(dirname(input.root), { recursive: true });
    } catch {
      throw new Error(
        `无法在安装目录（${input.installRoot}）下创建 document 文件夹。` +
          `请把程序安装在当前用户可写的目录，或设置 AI_TEACHING_INSTALL_DIR 指向可写位置。`,
      );
    }
    try {
      await cp(input.legacyRoot, input.root, { recursive: true, force: false, errorOnExist: true });
    } catch (error) {
      throw new Error(
        `旧工作区迁移失败：${(error as Error).message}。` +
          `旧目录（${input.legacyRoot}）已保留，没有删除任何数据。`,
      );
    }
    await verifyCopy(input.legacyRoot, input.root);
    // 校验通过才删旧目录；删不掉不算迁移失败，数据仍在新位置
    await rm(input.legacyRoot, { recursive: true, force: true }).catch(() => undefined);
    migrated = true;
  }
  await normalizeOcrLayout(input.root);
  return migrated ? "migrated" : "skipped";
}

/**
 * 应用启动时调用一次。
 *
 * 显式指定了工作区（测试、多工作区）就完全不动迁移逻辑。
 */
let layoutPromise: Promise<void> | null = null;

export function ensureWorkspaceLayout(): Promise<void> {
  // 显式工作区（测试/多工作区）不迁移，也不缓存——同一进程里可以换多个临时工作区
  if (process.env.AI_TEACHING_WORKSPACE?.trim()) return Promise.resolve();
  layoutPromise ??= migrateWorkspaceLayout({
    root: defaultWorkspaceRoot(),
    legacyRoot: legacyWorkspaceRoot(),
    installRoot: installRoot(),
  })
    .then(() => undefined)
    .catch((error) => {
      layoutPromise = null; // 下次调用再试，错误照常抛给调用方
      throw error;
    });
  return layoutPromise;
}
