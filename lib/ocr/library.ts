/**
 * 资料库位置迁移：`projects/<UUID>/sources/ocr/<job-id>/` → `sources/ocr/<学期>-<书种>-ocr/`。
 *
 * 2026-10-23 之前识别结果埋在项目 UUID 和任务 UUID 下面，老师根本找不到。
 * 迁移只在**没有产物正在写**的任务上做（运行中/整理中的任务等它结束），
 * 先在原位置改名，跨盘失败才退回复制+删除；记录与 manifest 同步补上 `dirName`。
 *
 * 幂等：有 `dirName` 的记录直接跳过。每个进程只跑一次。
 */

import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { listDir, readJsonDir, readJson, writeJson } from "../workspace/json.ts";
import { jobsDir, legacyOcrDir, legacyOcrJobDir, ocrJobDir, ocrLibraryDir } from "../workspace/paths.ts";
import { patchJob } from "./jobs.ts";
import {
  allocateLibraryDirName,
  detectTerm,
  normalizeTerm,
} from "./naming.ts";
import { existingLibraryDirNames } from "./naming-disk.ts";
import type { OcrJobRecord, OcrManifest } from "./types.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function moveDir(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch {
    // 目标已存在、跨盘或文件被占用：复制后删源；失败就保留下次再试
    if (await exists(to)) return false;
    try {
      await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      await rm(from, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function stampManifest(dir: string, term: string, dirName: string): Promise<void> {
  const path = join(dir, "manifest.json");
  const manifest = await readJson<OcrManifest | null>(path, null);
  if (!manifest) return;
  if (manifest.term === term && manifest.dirName === dirName) return;
  await writeJson(path, { ...manifest, term, dirName, updatedAt: new Date().toISOString() });
}

/** 迁移本体。幂等；测试直接调用它，不经进程级缓存。 */
export async function migrateLegacyOcrLibrary(): Promise<void> {
  const records = (await readJsonDir<OcrJobRecord>(jobsDir()))
    .filter((record) => record?.id && record.bookType)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reserved = await existingLibraryDirNames();
  for (const record of records) {
    if (record.dirName) reserved.add(record.dirName);
  }

  for (const record of records) {
    if (record.dirName) continue;
    // 正在写的任务不动：产物落点会在整理完成时按记录走
    if (record.status === "running" || record.status === "queued" || record.status === "normalizing") continue;
    const legacy = legacyOcrJobDir(record.projectId, record.id);
    if (!(await exists(legacy))) continue;
    const term = normalizeTerm(record.term) ?? detectTerm(record.originalName) ?? "winter";
    const dirName = await allocateLibraryDirName(term, record.bookType, reserved);
    reserved.add(dirName);
    await mkdir(ocrLibraryDir(), { recursive: true });
    if (!(await moveDir(legacy, ocrJobDir(dirName)))) continue;
    await stampManifest(ocrJobDir(dirName), term, dirName);
    await patchJob(record.id, { term, dirName }).catch(() => undefined);
  }

  // 没有任务记录的遗留目录（早期版本留下的已确认来源）：按 manifest 自述迁移
  const recorded = new Set(records.map((record) => record.id));
  const projectIds = new Set(records.map((record) => record.projectId));
  for (const projectId of projectIds) {
    for (const jobId of await listDir(legacyOcrDir(projectId))) {
      if (recorded.has(jobId)) continue;
      const legacy = legacyOcrJobDir(projectId, jobId);
      const manifest = await readJson<OcrManifest | null>(join(legacy, "manifest.json"), null);
      if (!manifest) continue;
      const term = normalizeTerm(manifest.term) ?? detectTerm(manifest.originalName) ?? "winter";
      const dirName = await allocateLibraryDirName(term, manifest.bookType, reserved);
      reserved.add(dirName);
      if (!(await moveDir(legacy, ocrJobDir(dirName)))) continue;
      await stampManifest(ocrJobDir(dirName), term, dirName);
    }
  }
}

let started: Promise<void> | null = null;

/** 每个进程跑一次；失败不阻断页面（下次调用再试）。 */
export function ensureOcrLibraryLayout(): Promise<void> {
  started ??= migrateLegacyOcrLibrary().catch(() => {
    started = null;
  });
  return started;
}
