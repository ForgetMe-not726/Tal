import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorkspace } from "../lib/workspace/bootstrap.ts";
import { reviewJobDir } from "../lib/workspace/paths.ts";
import {
  assertJobId,
  createJobRecord,
  listJobRecords,
  patchJobRecord,
  readDecisions,
  readFindings,
  readJobRecord,
  readManifest,
  readReport,
  saveDecision,
  writeFindings,
  writeManifest,
  writeReport,
} from "../lib/review/jobs.ts";
import { buildReviewReport } from "../lib/review/report.ts";
import { ReviewError } from "../lib/review/types.ts";

function withWorkspace(run) {
  const root = mkdtempSync(join(tmpdir(), "review-jobs-"));
  process.env.AI_TEACHING_WORKSPACE = root;
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => {
      delete process.env.AI_TEACHING_WORKSPACE;
      rmSync(root, { recursive: true, force: true });
    });
}

const PROJECT = "p-1";
const LESSON = 1;

function manifestOf(jobId, overrides = {}) {
  return {
    jobId,
    projectId: PROJECT,
    lessonNumber: LESSON,
    lessonTitle: "Fond memories",
    lessonType: "regular",
    scope: "module",
    bookType: "workbook",
    status: "ready",
    inputs: [
      { bookType: "workbook", moduleId: "m-1", moduleKey: "day_1", moduleLabel: "Day 1", versionId: "v1", versionNumber: 1 },
    ],
    rules: { snapshotVersion: null, resolvedAt: "2026-10-08T10:00:00.000Z", entries: [] },
    sources: [],
    pipeline: [{ name: "rule_checks", status: "ok", findingCount: 1 }],
    engine: null,
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    stats: {
      total: 1,
      byStatus: { pending: 1, adopt: 0, ignore: 0, recheck: 0 },
      byBook: { workbook: 1 },
      insufficientEvidence: 0,
    },
    ...overrides,
  };
}

function findingOf(id, overrides = {}) {
  return {
    id,
    ruleKey: "R-WB-004",
    ruleType: "review",
    stage: "rule_checks",
    bookType: "workbook",
    moduleKey: "day_1",
    moduleLabel: "Day 1",
    lessonNumber: LESSON,
    lessonType: "regular",
    versionId: "v1",
    versionNumber: 1,
    anchor: { quote: "引文", blockIndex: 1 },
    message: "问题",
    ...overrides,
  };
}

async function testJobRoundTrip() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const record = await createJobRecord({ projectId: PROJECT, lessonNumber: LESSON });
    assert.equal(record.status, "queued");
    assert.equal(record.stage, "待审校");

    const patched = await patchJobRecord(record.id, { status: "running", stage: "审校中" });
    assert.equal(patched.status, "running");
    assert.equal((await readJobRecord(record.id)).stage, "审校中");

    const listed = await listJobRecords({ projectId: PROJECT });
    assert.equal(listed.length, 1);
    assert.deepEqual(await listJobRecords({ projectId: "别的项目" }), []);
  });
}

/**
 * 陈旧任务恢复：审校在应用进程内跑，没有子进程可查，所以按**心跳**判定——
 * `running` 但很久没更新说明进程没了，标 `interrupted`，界面给"重新审校"。
 */
async function testStaleJobIsRepaired() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const record = await createJobRecord({ projectId: PROJECT, lessonNumber: LESSON });
    await patchJobRecord(record.id, { status: "running", stage: "审校中" });

    // 假装时间过去了 20 分钟
    const future = Date.now() + 20 * 60 * 1000;
    const [repaired] = await listJobRecords({}, { now: future });
    assert.equal(repaired.status, "interrupted");
    assert.match(repaired.message, /重新审校/);

    // 心跳还新的时候不动它
    const record2 = await createJobRecord({ projectId: PROJECT, lessonNumber: LESSON });
    await patchJobRecord(record2.id, { status: "running", stage: "审校中" });
    const fresh = await listJobRecords({}, { now: Date.now() + 1000 });
    assert.equal(fresh.find((item) => item.id === record2.id).status, "running");
  });
}

/** 人工决定：三种动作都能存，findings 与 manifest 统计一起更新。 */
async function testDecisions() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const record = await createJobRecord({ projectId: PROJECT, lessonNumber: LESSON });
    await writeFindings(PROJECT, LESSON, record.id, [findingOf("F-1"), findingOf("F-2")]);
    await writeManifest(PROJECT, LESSON, manifestOf(record.id));

    const adopted = await saveDecision({
      projectId: PROJECT,
      lessonNumber: LESSON,
      jobId: record.id,
      findingId: "F-1",
      action: "adopt",
      note: "按建议改了",
    });
    assert.equal(adopted.decisions["F-1"].action, "adopt");
    assert.equal(adopted.decisions["F-1"].note, "按建议改了");
    assert.equal(adopted.decisions["F-1"].decidedBy, "teacher");
    assert.equal(adopted.findings.find((item) => item.id === "F-1").decision.action, "adopt");
    // manifest 统计跟着更新（报告与筛选的数字来源）
    const manifest = await readManifest(PROJECT, LESSON, record.id);
    assert.equal(manifest.stats.byStatus.adopt, 1);
    assert.equal(manifest.stats.byStatus.pending, 1);

    // 再标一条"待复查"，并且可以改主意（决定不是终态）
    await saveDecision({
      projectId: PROJECT,
      lessonNumber: LESSON,
      jobId: record.id,
      findingId: "F-2",
      action: "recheck",
    });
    await saveDecision({
      projectId: PROJECT,
      lessonNumber: LESSON,
      jobId: record.id,
      findingId: "F-2",
      action: "ignore",
      note: "看错了",
    });
    const decisions = await readDecisions(PROJECT, LESSON, record.id);
    assert.equal(decisions["F-2"].action, "ignore");
    assert.equal(Object.keys(decisions).length, 2, "两条各有一条决定");

    // 找不到的 Finding 要报错，不静默
    await assert.rejects(
      () =>
        saveDecision({
          projectId: PROJECT,
          lessonNumber: LESSON,
          jobId: record.id,
          findingId: "F-404",
          action: "adopt",
        }),
      /找不到这条问题/,
    );
  });
}

/** 报告是可重建物：删掉再生成，内容一致；findings/decisions 不受影响。 */
async function testReportIsRebuildable() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const record = await createJobRecord({ projectId: PROJECT, lessonNumber: LESSON });
    const findings = [findingOf("F-1"), findingOf("F-2", { unverified: true })];
    await writeFindings(PROJECT, LESSON, record.id, findings);
    await writeManifest(PROJECT, LESSON, manifestOf(record.id));
    await saveDecision({
      projectId: PROJECT,
      lessonNumber: LESSON,
      jobId: record.id,
      findingId: "F-1",
      action: "ignore",
    });

    const manifest = await readManifest(PROJECT, LESSON, record.id);
    const stored = await readFindings(PROJECT, LESSON, record.id);
    const first = buildReviewReport(manifest, stored);
    const path = await writeReport(PROJECT, LESSON, record.id, first);
    assert.equal(existsSync(path), true);
    assert.equal(await readReport(PROJECT, LESSON, record.id), first);
    // 生成报告会记时间，但**不改** findings
    const afterReport = await readManifest(PROJECT, LESSON, record.id);
    assert.equal(typeof afterReport.reportGeneratedAt, "string");
    assert.deepEqual(await readFindings(PROJECT, LESSON, record.id), stored);

    // 删掉报告重新生成 → 内容一致（除了报告时间那一行）
    rmSync(path);
    assert.equal(await readReport(PROJECT, LESSON, record.id), null);
    const regenerated = buildReviewReport(
      await readManifest(PROJECT, LESSON, record.id),
      stored,
    );
    assert.equal(regenerated, first, "同一份事实源必须生成同一份报告");
    // 决定还在
    assert.equal((await readDecisions(PROJECT, LESSON, record.id))["F-1"].action, "ignore");
  });
}

/** 任务标识必须是安全的目录名（挡住路径逃逸）。 */
function testJobIdValidation() {
  assert.equal(assertJobId("0b6f1e2a-1111-2222-3333-444455556666"), "0b6f1e2a-1111-2222-3333-444455556666");
  assert.throws(() => assertJobId("../evil"), ReviewError);
  assert.throws(() => assertJobId("a/b"), ReviewError);
  assert.throws(() => assertJobId(""), ReviewError);
  assert.throws(() => assertJobId(".hidden"), ReviewError);
}

/** 缺产物时给可读错误，不返回空壳。 */
async function testMissingArtifacts() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    await assert.rejects(() => readManifest(PROJECT, LESSON, "不存在"), /还没有结果/);
    await assert.rejects(() => readJobRecord("不存在"), /审校任务不存在/);
    // findings 缺文件时按空数组（还没跑完是正常状态）
    assert.deepEqual(await readFindings(PROJECT, LESSON, "不存在"), []);
    assert.deepEqual(await readDecisions(PROJECT, LESSON, "不存在"), {});
    // 任务目录在 lesson 下
    assert.match(reviewJobDir(PROJECT, LESSON, "j"), /lessons[\\/]lesson-01[\\/]review[\\/]j$/);
  });
}

const tests = [
  ["任务读写与列表", testJobRoundTrip],
  ["陈旧任务按心跳恢复（回归）", testStaleJobIsRepaired],
  ["人工决定：采用/忽略/复查与统计同步", testDecisions],
  ["报告可重建、不覆盖事实源", testReportIsRebuildable],
  ["任务标识校验（路径安全）", testJobIdValidation],
  ["缺产物给可读错误", testMissingArtifacts],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`审校任务与产物测试通过:${tests.length} 项`);
