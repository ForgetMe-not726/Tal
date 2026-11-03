import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 本地资料库的离线测试：真实文件系统 + 临时工作区，PDF 抽取用注入的假实现，
 * 不依赖 MinerU/Python；真实 PDF 的集成验收在安装版上做。
 */

const root = mkdtempSync(join(tmpdir(), "library-test-"));
process.env.AI_TEACHING_WORKSPACE = join(root, "document");
process.env.AI_TEACHING_INSTALL_DIR = root;

const store = await import("../lib/library/store.ts");
const { collectLibraryCorpus } = await import("../lib/library/search.ts");

function sourceFiles() {
  const dir = join(root, "incoming");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "notes.md"), "# 阅读笔记\n\nenvironment 主题词汇\n<!-- page 0 -->\n");
  writeFileSync(join(dir, "reader.pdf"), "%PDF-1.4\nfake\n");
  return dir;
}

async function testMarkdownImportAndSearch() {
  const dir = sourceFiles();
  const items = await store.importLibraryFiles([join(dir, "notes.md")]);
  assert.equal(items.length, 1);
  const item = await store.indexLibraryItem(items[0].id);
  assert.equal(item.state, "ready");
  assert.equal(item.documents[0].status, "indexed");
  assert.equal(item.documents[0].searchable, true);
  const corpus = await collectLibraryCorpus();
  assert.equal(corpus.docs.length, 1);
  assert.equal(corpus.docs[0].pageIndex, null);
  assert.match(corpus.docs[0].text, /environment/u);
}

async function testPdfWithTextGetsPageEvidence() {
  const dir = sourceFiles();
  const items = await store.importLibraryFiles([join(dir, "reader.pdf")]);
  const item = await store.indexLibraryItem(items[0].id, {
    extractPdf: async () => ({
      pageCount: 2,
      pages: [
        { index: 0, text: "environment 环境 environment", chars: 25 },
        { index: 1, text: "weather 天气 weather", chars: 22 },
      ],
    }),
  });
  assert.equal(item.state, "ready");
  const corpus = await collectLibraryCorpus();
  const pdf = corpus.docs.find((doc) => doc.documentId === item.documents[0].id && doc.pageIndex === 0);
  assert.ok(pdf, "PDF 命中要带页码");
  assert.match(pdf.pageImageUrl, /\/api\/library\/items\/.+\/page\?file=/u);
}

async function testScannedPdfIsNotSearchable() {
  const dir = sourceFiles();
  const items = await store.importLibraryFiles([join(dir, "reader.pdf")]);
  const item = await store.indexLibraryItem(items[0].id, {
    extractPdf: async () => ({ pageCount: 2, pages: [{ index: 0, text: "", chars: 0 }, { index: 1, text: "", chars: 0 }] }),
  });
  assert.equal(item.documents[0].status, "needs_ocr");
  assert.equal(item.documents[0].searchable, false);
  const corpus = await collectLibraryCorpus();
  assert.equal(
    corpus.docs.filter((doc) => doc.itemId === item.id && doc.documentId === item.documents[0].id).length,
    0,
    "扫描件没有 OCR 前不能成为检索依据",
  );
}

async function testRemoveMovesToRecycle() {
  const dir = sourceFiles();
  const items = await store.importLibraryFiles([join(dir, "notes.md")]);
  await store.indexLibraryItem(items[0].id);
  const result = await store.removeLibraryItem(items[0].id);
  assert.equal(existsSync(join(process.env.AI_TEACHING_WORKSPACE, "library", items[0].id)), false);
  assert.equal(existsSync(result.recyclePath), true);
  assert.equal((await store.listLibraryItems()).some((entry) => entry.id === items[0].id), false);
}

function testPathSafety() {
  return store.removeLibraryItem("../escape").then(
    () => assert.fail("路径穿越必须被拒绝"),
    (error) => assert.match(error.message, /无效|不存在|范围/u),
  );
}

async function testFolderImportPreservesStructure() {
  const dir = join(root, "folder-source");
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "a.md"), "A\n");
  writeFileSync(join(dir, "nested", "b.md"), "B\n");
  writeFileSync(join(dir, "ignore.txt"), "ignored\n");
  const item = await store.importLibraryFolder(dir);
  assert.equal(item.kind, "folder");
  assert.equal(item.documents.length, 2);
  assert.ok(item.documents.some((doc) => doc.relativePath.includes("nested")));
  assert.equal(existsSync(join(process.env.AI_TEACHING_WORKSPACE, "library", item.id, "files", "ignore.txt")), false);
}

const tests = [
  ["Markdown 导入、索引与检索", testMarkdownImportAndSearch],
  ["数字版 PDF 带页图证据", testPdfWithTextGetsPageEvidence],
  ["扫描 PDF 在没有 OCR 前不参与检索", testScannedPdfIsNotSearchable],
  ["移除到回收区且列表消失", testRemoveMovesToRecycle],
  ["路径穿越被拒绝", testPathSafety],
  ["文件夹导入保留结构并跳过非资料文件", testFolderImportPreservesStructure],
];

try {
  for (const [name, test] of tests) {
    await test();
    console.log(`✓ ${name}`);
  }
  console.log(`本地资料库测试通过:${tests.length} 项`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
