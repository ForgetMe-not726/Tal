import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_ORIGINAL_BYTES,
  assertBookType,
  assertImportable,
  canTransition,
  confirmJob,
  createJob,
  listConfirmedSources,
  listJobs,
  normalizeIntoWorkspace,
  patchJob,
  readContent,
  readJob,
  readManifest,
  saveContent,
  storeOriginal,
} from "../lib/ocr/jobs.ts";
import { resolveInWorkspace, WorkspaceFileError } from "../lib/workspace/files.ts";
import { parseProgress } from "../lib/ocr/mineru.ts";
import { ensureWorkspace } from "../lib/workspace/bootstrap.ts";
import { ocrJobDir } from "../lib/workspace/paths.ts";

/** 临时工作区：与 test-file-store.mjs 同款注入方式（环境变量 + 系统临时目录）。 */
function withWorkspace(run) {
  const root = mkdtempSync(join(tmpdir(), "ocr-jobs-"));
  process.env.AI_TEACHING_WORKSPACE = root;
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => {
      delete process.env.AI_TEACHING_WORKSPACE;
      rmSync(root, { recursive: true, force: true });
    });
}

const PROJECT = "p-1";

/** 造一个上游产物目录（content_list + middle + images），用来验证归一化落盘。 */
function fakeUpstream(root) {
  const dir = join(root, "upstream");
  mkdirSync(join(dir, "images"), { recursive: true });
  writeFileSync(join(dir, "images", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  const contentList = [
    { type: "text", page_idx: 0, text: "第1讲 知识清单", text_level: 1, bbox: [100, 100, 400, 140] },
    { type: "table", page_idx: 0, table_body: "<table><tr><td>x</td></tr></table>", img_path: "images/a.jpg", bbox: [100, 200, 900, 400] },
    { type: "footer", page_idx: 0, text: "Unit 1", bbox: [100, 950, 200, 980] },
    { type: "text", page_idx: 1, text: "正文", bbox: [100, 100, 300, 140] },
  ];
  const middle = {
    _backend: "pipeline",
    _version_name: "3.4.5",
    pdf_info: [
      { page_idx: 0, page_size: [595, 841], para_blocks: [{ score: 0.5, bbox: [60, 60, 240, 84], lines: [{ spans: [{ content: "第1讲 知识清单" }] }] }] },
      { page_idx: 1, page_size: [595, 841], para_blocks: [] },
    ],
  };
  return { dir, contentList, middle };
}

async function testJobRoundTrip() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const job = await createJob({
      projectId: PROJECT,
      bookType: "knowledge",
      originalName: "寒假知识清单.pdf",
      originalPath: "/tmp/whatever.pdf",
    });
    assert.equal(job.status, "queued");
    assert.equal(job.stage, "待识别");

    const read = await readJob(job.id);
    assert.equal(read.id, job.id);

    const patched = await patchJob(job.id, { status: "running", pid: process.pid, stage: "识别中" });
    assert.equal(patched.status, "running");
    // 读-改-写不能丢别的字段
    assert.equal(patched.originalName, "寒假知识清单.pdf");

    const listed = await listJobs({ projectId: PROJECT });
    assert.equal(listed.length, 1);
    // pid 是自己，算活着 → 不改状态
    assert.equal(listed[0].status, "running");
    assert.deepEqual(await listJobs({ projectId: "别的项目" }), []);
  });
}

/**
 * 陈旧任务恢复：服务重启后子进程没了，但文件里还写着 running。
 * 不修正界面会一直转圈，所以按 pid 存活判定并改标 interrupted（可重新识别）。
 */
async function testStaleJobIsRepaired() {
  await withWorkspace(async () => {
    await ensureWorkspace();
    const job = await createJob({
      projectId: PROJECT,
      bookType: "student",
      originalName: "a.pdf",
      originalPath: "/tmp/a.pdf",
    });
    // 造一个几乎不可能存在的 pid
    await patchJob(job.id, { status: "running", pid: 999999, stage: "识别中" });
    const [listed] = await listJobs();
    assert.equal(listed.status, "interrupted");
    assert.match(listed.message, /重新识别/);
    assert.equal(listed.pid, undefined, "清掉死 pid");
    // 再列一次不会重复改写
    const again = await listJobs();
    assert.equal(again[0].status, "interrupted");
  });
}

async function testNormalizeWritesContractFiles() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const upstream = fakeUpstream(root);
    const job = await createJob({
      projectId: PROJECT,
      bookType: "knowledge",
      originalName: "寒假知识清单.pdf",
      originalPath: "/tmp/x.pdf",
    });
    const result = await normalizeIntoWorkspace({
      job,
      upstreamDir: upstream.dir,
      contentList: upstream.contentList,
      middle: upstream.middle,
      imagesDir: join(upstream.dir, "images"),
      method: "ocr",
      language: "ch",
      // 没有 origin.pdf：页图渲染跳过并记一条提醒（不静默）
    });

    assert.equal(result.manifest.status, "ready");
    assert.equal(result.manifest.engine.version, "3.4.5");
    assert.equal(result.manifest.pageCount, 2);
    assert.equal(
      result.manifest.warnings.some((text) => text.includes("页图")),
      true,
      "缺 origin.pdf 要留提醒",
    );

    const jobDir = ocrJobDir(PROJECT, job.id);
    const markdown = await readContent(PROJECT, job.id);
    assert.match(markdown, /^<!-- page 0 -->/m);
    // 正文自己写了课号标题（`# 第1讲 知识清单`）→ 不再补一个，也不重复
    assert.match(markdown, /^# 第1讲 知识清单$/m);
    assert.doesNotMatch(markdown, /^# Unit 1$/m, "正文声明过就不该再补一个课标题");
    assert.match(markdown, /<table>/, "表格 HTML 保留");
    assert.doesNotMatch(markdown, /^Unit 1$/m, "页脚本身不进正文");

    const structure = JSON.parse(
      (await import("node:fs")).readFileSync(join(jobDir, "structure.json"), "utf8"),
    );
    assert.equal(structure.blocks.length, 4);
    assert.equal(structure.blocks[1].assetPath, "assets/a.jpg");
    assert.equal(structure.blocks[1].box.left, 0.1);
    // 资产被复制进 assets/
    assert.equal(
      (await import("node:fs")).existsSync(join(jobDir, "assets", "a.jpg")),
      true,
    );
    // diagnostics 记了上游目录与资产数
    const diagnostics = JSON.parse(
      (await import("node:fs")).readFileSync(join(jobDir, "diagnostics.json"), "utf8"),
    );
    assert.equal(diagnostics.assets, 1);
    // 大文件不进工作区
    assert.equal((await import("node:fs")).existsSync(join(jobDir, "_layout.pdf")), false);
  });
}

/** 确认前不能进生成；确认后不能再改；重复确认幂等。 */
async function testConfirmFlow() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const upstream = fakeUpstream(root);
    const job = await createJob({
      projectId: PROJECT,
      bookType: "knowledge",
      originalName: "寒假知识清单.pdf",
      originalPath: "/tmp/x.pdf",
    });
    await normalizeIntoWorkspace({
      job,
      upstreamDir: upstream.dir,
      contentList: upstream.contentList,
      middle: upstream.middle,
    });

    // 待核对：不出现在"已确认来源"里
    assert.deepEqual(await listConfirmedSources({ projectId: PROJECT }), []);

    await saveContent(PROJECT, job.id, "# 改过的正文\n");
    assert.equal(await readContent(PROJECT, job.id), "# 改过的正文\n");

    const confirmed = await confirmJob({ projectId: PROJECT, jobId: job.id });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.confirmedBy, "teacher");
    assert.equal(typeof confirmed.confirmedAt, "string");

    // 幂等
    const again = await confirmJob({ projectId: PROJECT, jobId: job.id });
    assert.equal(again.confirmedAt, confirmed.confirmedAt);

    // 已确认不能再改正文
    await assert.rejects(() => saveContent(PROJECT, job.id, "又改"), /不能再改/);

    // 已确认来源按书种过滤
    const sources = await listConfirmedSources({ projectId: PROJECT, bookType: "knowledge" });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].originalName, "寒假知识清单.pdf");
    assert.deepEqual(await listConfirmedSources({ projectId: PROJECT, bookType: "workbook" }), []);

    // manifest 缺了要报可读的错
    await assert.rejects(() => readManifest(PROJECT, "不存在"), /还没有产物|任务不存在/);
  });
}

function testImportValidation() {
  assert.equal(assertImportable("寒假学生用书.pdf"), "寒假学生用书.pdf");
  assert.equal(assertImportable("图 1.JPG"), "图 1.JPG");
  // 路径分隔符与前导点被清洗，不会写到别处（`safeSegment` 的既有行为）
  assert.equal(assertImportable("../坏.pdf"), "__坏.pdf");
  assert.equal(assertImportable("..\\..\\坏.pdf"), "__.._坏.pdf");
  assert.throws(() => assertImportable("病毒.exe"), /只接受 PDF 或图片/);
  assert.throws(() => assertImportable(""), /只接受/);
  assert.throws(() => assertBookType("小超市"), /书种不受支持/);
  assert.equal(assertBookType("workbook"), "workbook");
  assert.equal(MAX_ORIGINAL_BYTES > 209 * 1024 * 1024, true, "上限要容得下真实教材");
}

function testStateMachineRules() {
  // 只有一条不变量：已确认是终态。其余迁移（含重跑时的回退）都放行。
  assert.equal(canTransition("confirmed", "ready"), false, "确认后不能退回待核对");
  assert.equal(canTransition("confirmed", "failed"), false);
  assert.equal(canTransition("confirmed", "confirmed"), true);
  assert.equal(canTransition("ready", "normalizing"), true, "页图失败后重跑是合法的");
  assert.equal(canTransition("interrupted", "queued"), true);
  assert.equal(canTransition("failed", "running"), true);
}

/** 路径逃逸：工作区外的路径一律拒绝。 */
function testPathEscapeIsRejected() {
  const root = "D:/ws";
  assert.equal(resolveInWorkspace(root, "projects/p/sources/originals/a.pdf").startsWith("D"), true);
  assert.throws(() => resolveInWorkspace(root, "../outside.pdf"), WorkspaceFileError);
  assert.throws(() => resolveInWorkspace(root, "a/../../outside.pdf"), WorkspaceFileError);
  assert.throws(() => resolveInWorkspace(root, "C:/Windows/system32/x.pdf"), WorkspaceFileError);
  assert.throws(() => resolveInWorkspace(root, ""), WorkspaceFileError);
}

/** 原件复制进 sources/originals，且不改动源文件。 */
async function testStoreOriginal() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const source = join(root, "原书.pdf");
    writeFileSync(source, Buffer.from("%PDF-1.7 假装是 PDF"));
    const stored = await storeOriginal(PROJECT, "寒假知识清单.pdf", source);
    assert.equal(stored.bytes > 0, true);
    assert.match(stored.path, /sources[\\/]originals[\\/]寒假知识清单\.pdf$/);
    const copy = (await import("node:fs")).readFileSync(stored.path);
    assert.equal(copy.toString("utf8"), "%PDF-1.7 假装是 PDF");
    assert.equal((await import("node:fs")).existsSync(source), true, "源文件不能被搬走");
  });
}

/**
 * 进度解析：三种实测形态都要认，认不出就返回 null（**不编造百分比**）。
 *
 * 形态来自真实 stderr：tqdm 进度条、批次完成行、批次提交行。
 */
function testProgressParsing() {
  // tqdm（逐页，最有价值）
  assert.deepEqual(parseProgress("Layout Predict:  31%|███ | 16/52 [00:12<00:29, 1.24it/s]"), {
    done: 16,
    total: 52,
  });
  // 批次完成
  assert.deepEqual(parseProgress("Completed batch 1/1 | Processed 52/52 pages | 1 of 1 batches finished"), {
    done: 52,
    total: 52,
  });
  // 只有总数：先让界面显示"共 N 页"，done 留空
  assert.deepEqual(parseProgress("Submitting batch 1/1 | 52 pages total |"), { done: null, total: 52 });
  // 认不出就不猜
  assert.equal(parseProgress("INFO: Started server process [19576]"), null);
  assert.equal(parseProgress(""), null);
  // 越界/异常值不算进度
  assert.equal(parseProgress("batch 3/2 [x]"), null);
  assert.equal(parseProgress("Processed 5/0 pages"), null);

  // **区域数不是页数**（实测一本 83 页的书因此显示成 1314/1668 页）
  assert.equal(parseProgress("OCR-rec Predict:  89%|███ | 852/954 [00:25<00:06, 16.26it/s]"), null);
  assert.equal(parseProgress("OCR-det ch:  71%|███ | 588/692 [01:23<00:19,  5.12it/s]"), null);
  assert.equal(parseProgress("Seal Predict: 100%|███ | 83/83 [00:02<00:00]"), null);

  // 给了 PDF 真实页数：分母对不上的一律不算（哪怕它长得像页级阶段）
  assert.deepEqual(parseProgress("Layout Predict:  31%|███ | 16/52 [00:12]", 83), null);
  assert.deepEqual(parseProgress("Processing pages:  50%|███ | 41/83 [00:02]", 83), { done: 41, total: 83 });
  assert.deepEqual(parseProgress("Completed batch 1/1 | Processed 83/83 pages", 83), { done: 83, total: 83 });
}

const tests = [
  ["任务读写与列表", testJobRoundTrip],
  ["陈旧任务恢复（回归）", testStaleJobIsRepaired],
  ["归一化落盘写出契约文件", testNormalizeWritesContractFiles],
  ["确认流程：待核对 → 已确认（回归）", testConfirmFlow],
  ["导入校验与上限", testImportValidation],
  ["状态机规则", testStateMachineRules],
  ["OCR 进度解析（三种实测形态）", testProgressParsing],
  ["路径逃逸被拒", testPathEscapeIsRejected],
  ["原件复制进工作区且不改源文件", testStoreOriginal],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`OCR 任务与产物测试通过:${tests.length} 项`);
