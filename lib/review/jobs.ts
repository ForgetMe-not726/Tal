/**
 * 审校任务的存取。
 *
 * 两处存放，角色分明（与 OCR 同一套纪律）：
 * - `.app/jobs/<id>.json` —— **在跑任务的状态**，可重建；
 * - `lessons/<lesson-NN>/review/<job-id>/` —— **产物**：manifest / findings / decisions 是事实源，
 *   `report.html` 可重建。
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { lessonsDir, projectsDir, reviewDir } from "../workspace/paths.ts";
import { listDir, readJson, readJsonDir, updateJson, writeJson } from "../workspace/json.ts";
import {
  REVIEW_DECISIONS_FILE,
  REVIEW_FINDINGS_FILE,
  REVIEW_MANIFEST_FILE,
  REVIEW_REPORT_FILE,
  jobFile,
  jobsDir,
  reviewJobDir,
  safeSegment,
} from "../workspace/paths.ts";
import { writeBinaryAtomic } from "../workspace/files.ts";
import { summarize } from "./pipeline.ts";
import {
  ReviewError,
  type ReviewDecision,
  type ReviewFinding,
  type ReviewJobRecord,
  type ReviewJobStatus,
  type ReviewManifest,
} from "./types.ts";

/** 老师能看到的阶段说明（PRODUCT.md §5 的教研语言）。 */
export const REVIEW_STAGE_LABEL: Record<ReviewJobStatus, string> = {
  queued: "待审校",
  running: "审校中",
  ready: "待人工复核",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

export function assertJobId(jobId: string): string {
  const clean = safeSegment(jobId);
  if (clean !== jobId || !jobId.trim()) throw new ReviewError(`任务标识不合法：${jobId}`);
  return clean;
}

// ---------------------------------------------------------------------------
// 在跑任务的状态
// ---------------------------------------------------------------------------

export async function createJobRecord(input: {
  projectId: string;
  lessonNumber: number;
}): Promise<ReviewJobRecord> {
  const now = new Date().toISOString();
  const record: ReviewJobRecord = {
    id: randomUUID(),
    projectId: input.projectId,
    lessonNumber: input.lessonNumber,
    status: "queued",
    stage: REVIEW_STAGE_LABEL.queued,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(jobFile(record.id), record);
  return record;
}

export async function readJobRecord(jobId: string): Promise<ReviewJobRecord> {
  const record = await readJson<ReviewJobRecord | null>(jobFile(assertJobId(jobId)), null);
  if (!record) throw new ReviewError(`审校任务不存在：${jobId}`);
  return record;
}

export async function patchJobRecord(
  jobId: string,
  patch: Partial<ReviewJobRecord>,
): Promise<ReviewJobRecord> {
  const updated = await updateJson<ReviewJobRecord | null>(
    jobFile(assertJobId(jobId)),
    null,
    (current) => {
      if (!current) throw new ReviewError(`审校任务不存在：${jobId}`);
      return { ...current, ...patch, updatedAt: new Date().toISOString() };
    },
  );
  if (!updated) throw new ReviewError(`审校任务不存在：${jobId}`);
  return updated;
}

/**
 * 列出任务并修正陈旧状态。
 *
 * 审校在应用进程内跑（没有子进程可查），所以判据是**心跳**：`running` 但很久没更新，
 * 说明进程中途没了（应用重启/崩溃）→ 标 `interrupted`，界面给"重新审校"。
 * 不修正的话界面会一直转圈。
 */
/**
 * 从产物恢复缺失的任务记录。
 *
 * 起因：`.app/jobs` 是 OCR 与审校**共用**的目录，曾经被识别侧的清理逻辑误删过审校记录
 * （产物目录还在、任务列表里却没了）。任务记录是可重建的——manifest 里全都有。
 * 只补**缺失**的，不覆盖已有记录。
 */
export async function restoreMissingReviewJobRecords(): Promise<number> {
  let restored = 0;
  for (const projectId of await listDir(projectsDir())) {
    for (const lessonName of await listDir(lessonsDir(projectId))) {
      const lessonNumber = Number(/lesson-(\d+)/u.exec(lessonName)?.[1]);
      if (!Number.isInteger(lessonNumber)) continue;
      for (const jobId of await listDir(reviewDir(projectId, lessonNumber))) {
        const manifest = await readJson<ReviewManifest | null>(
          join(reviewDir(projectId, lessonNumber), jobId, "manifest.json"),
          null,
        );
        if (!manifest?.jobId) continue;
        const existing = await readJson<ReviewJobRecord | null>(jobFile(manifest.jobId), null);
        if (existing) continue;
        const status = manifest.status ?? "ready";
        const now = manifest.updatedAt ?? manifest.createdAt ?? new Date().toISOString();
        await writeJson(jobFile(manifest.jobId), {
          id: manifest.jobId,
          projectId,
          lessonNumber,
          status,
          stage: REVIEW_STAGE_LABEL[status] ?? "待人工复核",
          createdAt: manifest.createdAt ?? now,
          updatedAt: now,
          ...(manifest.finishedAt ? { finishedAt: manifest.finishedAt } : {}),
        } satisfies ReviewJobRecord);
        restored += 1;
      }
    }
  }
  return restored;
}

export async function listJobRecords(
  filter: { projectId?: string; lessonNumber?: number } = {},
  options: { staleAfterMs?: number; now?: number } = {},
): Promise<ReviewJobRecord[]> {
  const staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
  const nowMs = options.now ?? Date.now();
  // 记录可能被误删过（`.app/jobs` 与识别共用）：先从产物补回来
  await restoreMissingReviewJobRecords();
  const records = await readJsonDir<ReviewJobRecord>(jobsDir());
  const out: ReviewJobRecord[] = [];
  for (const record of records) {
    if (!record?.id) continue;
    if (record.status === "running" || record.status === "queued") {
      const age = nowMs - new Date(record.updatedAt).getTime();
      if (age > staleAfterMs) {
        const repaired = await patchJobRecord(record.id, {
          status: "interrupted",
          stage: REVIEW_STAGE_LABEL.interrupted,
          message: "审校过程被中断（应用或服务重启）。可以重新审校。",
          finishedAt: new Date().toISOString(),
        });
        out.push(repaired);
        continue;
      }
    }
    out.push(record);
  }
  const filtered = out.filter(
    (record) =>
      (!filter.projectId || record.projectId === filter.projectId) &&
      (filter.lessonNumber == null || record.lessonNumber === filter.lessonNumber),
  );
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// 产物
// ---------------------------------------------------------------------------

export async function writeManifest(
  projectId: string,
  lessonNumber: number,
  manifest: ReviewManifest,
): Promise<void> {
  await writeJson(join(reviewJobDir(projectId, lessonNumber, manifest.jobId), REVIEW_MANIFEST_FILE), manifest);
}

export async function readManifest(
  projectId: string,
  lessonNumber: number,
  jobId: string,
): Promise<ReviewManifest> {
  const manifest = await readJson<ReviewManifest | null>(
    join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_MANIFEST_FILE),
    null,
  );
  if (!manifest) throw new ReviewError(`审校任务 ${jobId} 还没有结果`);
  return manifest;
}

export async function writeFindings(
  projectId: string,
  lessonNumber: number,
  jobId: string,
  findings: ReviewFinding[],
): Promise<void> {
  await writeJson(join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_FINDINGS_FILE), findings);
}

export async function readFindings(
  projectId: string,
  lessonNumber: number,
  jobId: string,
): Promise<ReviewFinding[]> {
  return readJson<ReviewFinding[]>(
    join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_FINDINGS_FILE),
    [],
  );
}

/** 老师决定：`findingId → decision`。事实源之一，重新审校不覆盖它。 */
export async function readDecisions(
  projectId: string,
  lessonNumber: number,
  jobId: string,
): Promise<Record<string, ReviewDecision>> {
  return readJson<Record<string, ReviewDecision>>(
    join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_DECISIONS_FILE),
    {},
  );
}

/**
 * 保存一条人工决定，并把 findings 里的决定与 manifest 的统计一起更新。
 *
 * 三份文件必须一致：`decisions.json` 是决定的落点，`findings.json` 里带决定便于界面与报告
 * 一次读完，`manifest.stats` 是报告与筛选的数字来源。
 */
export async function saveDecision(input: {
  projectId: string;
  lessonNumber: number;
  jobId: string;
  findingId: string;
  action: ReviewDecision["action"];
  note?: string;
  decidedBy?: string;
}): Promise<{ findings: ReviewFinding[]; decisions: Record<string, ReviewDecision> }> {
  const dir = reviewJobDir(input.projectId, input.lessonNumber, input.jobId);
  const findings = await readFindings(input.projectId, input.lessonNumber, input.jobId);
  const target = findings.find((finding) => finding.id === input.findingId);
  if (!target) throw new ReviewError(`找不到这条问题：${input.findingId}`);

  const decision: ReviewDecision = {
    action: input.action,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    decidedAt: new Date().toISOString(),
    decidedBy: input.decidedBy?.trim() || "teacher",
  };
  const decisions = await updateJson<Record<string, ReviewDecision>>(
    join(dir, REVIEW_DECISIONS_FILE),
    {},
    (current) => ({ ...current, [input.findingId]: decision }),
  );
  const updated = findings.map((finding) =>
    finding.id === input.findingId ? { ...finding, decision } : finding,
  );
  await writeFindings(input.projectId, input.lessonNumber, input.jobId, updated);

  const manifest = await readManifest(input.projectId, input.lessonNumber, input.jobId);
  await writeManifest(input.projectId, input.lessonNumber, {
    ...manifest,
    stats: summarize(updated),
    updatedAt: new Date().toISOString(),
  });
  return { findings: updated, decisions };
}

export async function writeReport(
  projectId: string,
  lessonNumber: number,
  jobId: string,
  html: string,
): Promise<string> {
  const manifest = await readManifest(projectId, lessonNumber, jobId);
  const now = new Date().toISOString();
  const withTime: ReviewManifest = { ...manifest, reportGeneratedAt: now, updatedAt: now };
  const path = join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_REPORT_FILE);
  await writeBinaryAtomic(path, Buffer.from(html, "utf8"));
  await writeManifest(projectId, lessonNumber, withTime);
  return path;
}

export async function readReport(
  projectId: string,
  lessonNumber: number,
  jobId: string,
): Promise<string | null> {
  const { readBinary } = await import("../workspace/files.ts");
  const buffer = await readBinary(join(reviewJobDir(projectId, lessonNumber, jobId), REVIEW_REPORT_FILE));
  return buffer ? buffer.toString("utf8") : null;
}

/** 任务目录里有哪些文件（诊断用）。 */
export async function reviewJobFiles(
  projectId: string,
  lessonNumber: number,
  jobId: string,
): Promise<string[]> {
  return listDir(reviewJobDir(projectId, lessonNumber, jobId));
}
