import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 已确认 OCR 目录 → 助手语料；不依赖任务记录。 */

const root = mkdtempSync(join(tmpdir(), "ocr-corpus-"));
process.env.AI_TEACHING_WORKSPACE = join(root, "document");
process.env.AI_TEACHING_INSTALL_DIR = root;

const ocr = join(process.env.AI_TEACHING_WORKSPACE, "ocr");
mkdirSync(ocr, { recursive: true });

function writeJob(dirName, { status = "confirmed", jobId = "job-1", content, structure }) {
  const dir = join(ocr, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    jobId,
    projectId: "p1",
    bookType: "student",
    originalName: "寒假学生用书.pdf",
    originalBytes: 1,
    status,
    engine: { name: "MinerU", version: "3.4.5", backend: "pipeline", method: "ocr", language: "ch" },
    pageCount: 2,
    pages: { format: "jpeg", dpi: 150, quality: 85 },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    confirmedAt: "2026-11-01T00:00:00.000Z",
    dirName,
  }));
  writeFileSync(join(dir, "content.md"), content);
  if (structure) writeFileSync(join(dir, "structure.json"), JSON.stringify(structure));
}

writeJob("winter-sb-ocr", {
  content: "<!-- page 3 -->\n# Unit 9\n核心词汇 environment 环境\n",
  structure: {
    jobId: "job-1",
    pageCount: 2,
    pages: [{ index: 3, width: 612, height: 824, blockCount: 1 }],
    blocks: [{ id: "b00042", type: "text", pageIndex: 3, order: 42, bbox: [0, 0, 0, 0], box: { left: 0.1, top: 0.2, width: 0.4, height: 0.05 }, text: "核心词汇 environment 环境" }],
    lowConfidence: [],
  },
});
writeJob("ready-sb-ocr", { status: "ready", jobId: "job-ready", content: "<!-- page 0 -->\nshould not appear" });

const { collectOcrCorpus } = await import("../lib/assistant/ocr-corpus.ts");
const { locateOcrEvidence } = await import("../lib/assistant/ocr-evidence.ts");

const result = await collectOcrCorpus({ scope: "workspace" });
assert.equal(result.docs.length, 1, "只收 confirmed 目录");
const doc = result.docs[0];
assert.equal(doc.jobId, "job-1");
const evidence = locateOcrEvidence(doc, ["environment"]);
assert.equal(evidence.pageIndex, 3);
assert.equal(evidence.blockId, "b00042");
assert.deepEqual(evidence.box, { left: 0.1, top: 0.2, width: 0.4, height: 0.05 });

// 老师改过 content.md、旧 structure 块不再出现：只定位到页，不伪造旧块坐标。
writeJob("winter-sb-ocr", {
  content: "<!-- page 3 -->\n# Unit 9\n核心词汇 forest 森林\n",
  structure: {
    jobId: "job-1",
    pageCount: 2,
    pages: [{ index: 3, width: 612, height: 824, blockCount: 1 }],
    blocks: [{ id: "b00042", type: "text", pageIndex: 3, order: 42, bbox: [0, 0, 0, 0], box: { left: 0.1, top: 0.2, width: 0.4, height: 0.05 }, text: "核心词汇 environment 环境" }],
    lowConfidence: [],
  },
});
const edited = await collectOcrCorpus({ scope: "workspace" });
const editedEvidence = locateOcrEvidence(edited.docs[0], ["forest"]);
assert.equal(editedEvidence.pageIndex, 3);
assert.equal(editedEvidence.blockId, null);
assert.equal(editedEvidence.box, null);

// 没有 structure 时按正文页定位。
rmSync(join(ocr, "winter-sb-ocr", "structure.json"));
const noStructure = await collectOcrCorpus({ scope: "workspace" });
const pageOnly = locateOcrEvidence(noStructure.docs[0], ["forest"]);
assert.equal(pageOnly.pageIndex, 3);
assert.equal(pageOnly.blockId, null);

rmSync(root, { recursive: true, force: true });
console.log("✓ OCR 目录语料：confirmed 过滤、块坐标、教师修订降级");
console.log("OCR 语料测试通过:3 项");
