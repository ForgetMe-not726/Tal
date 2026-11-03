/**
 * 把开发工作区里已整理的范本集合整理成可随安装包分发的精简副本。
 *
 * 只带生成/检索真正读取的部分：
 *   manifest.json + modules/ + ocr/<book>/pages/
 * 不带原书 PDF、assets、structure/content（体积约 400 MB；页图约 67 MB）。
 *
 * 源目录是 gitignored 的本地教材工作区；构建机必须事先准备好集合，或通过
 * KNOWLEDGE_COLLECTION_SOURCE / KNOWLEDGE_COLLECTION_IDS 指定。
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sourceRoot = process.env.KNOWLEDGE_COLLECTION_SOURCE
  ? join(root, process.env.KNOWLEDGE_COLLECTION_SOURCE)
  : join(root, "document", "knowledge", "collections");
const ids = (process.env.KNOWLEDGE_COLLECTION_IDS ?? "autumn-2026-l5")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const output = join(root, "build", "knowledge-collections");
const defaultLicense = "内部教研使用；随包分发经需求方确认（A-018，2026-10-27）";

function fail(message) {
  throw new Error(message);
}

async function readManifest(collectionDir) {
  const path = join(collectionDir, "manifest.json");
  if (!existsSync(path)) fail(`缺少 manifest.json：${collectionDir}`);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`manifest.json 不是合法 JSON：${path}（${error.message}）`);
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.books) || !manifest.id) {
    fail(`集合 manifest 格式不支持：${path}`);
  }
  return manifest;
}

async function countFiles(dir) {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

async function main() {
  if (ids.length === 0) fail("没有配置要随包的集合 id");
  if (!existsSync(sourceRoot)) {
    fail(`找不到集合源目录：${sourceRoot}。请先准备 document/knowledge/collections 或设置 KNOWLEDGE_COLLECTION_SOURCE。`);
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  let totalPages = 0;
  let totalModules = 0;
  for (const id of ids) {
    const source = join(sourceRoot, id);
    const manifest = await readManifest(source);
    if (manifest.id !== id) fail(`集合目录名与 manifest.id 不一致：${id} != ${manifest.id}`);
    const modulesDir = join(source, "modules");
    if (!existsSync(modulesDir)) fail(`集合缺少 modules/：${source}`);
    const target = join(output, id);
    await mkdir(target, { recursive: true });
    await cp(modulesDir, join(target, "modules"), { recursive: true });

    for (const book of manifest.books) {
      if (typeof book.ocrDir !== "string" || !book.ocrDir) continue;
      const pages = join(source, book.ocrDir, "pages");
      if (!existsSync(pages)) {
        console.warn(`警告：${id}/${book.bookType} 没有 pages/，原页证据不可用`);
        continue;
      }
      const targetPages = join(target, book.ocrDir, "pages");
      await cp(pages, targetPages, { recursive: true });
      totalPages += await countFiles(targetPages);
    }

    const license = process.env.KNOWLEDGE_COLLECTION_LICENSE?.trim() || manifest.license?.trim() || defaultLicense;
    const stagedManifest = { ...manifest, license };
    await writeFile(join(target, "manifest.json"), `${JSON.stringify(stagedManifest, null, 2)}\n`, "utf8");
    totalModules += await countFiles(join(target, "modules"));
    console.log(`已整理集合 ${id}：${manifest.books.length} 本书 / ${manifest.title}`);
  }

  let bytes = 0;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) bytes += (await stat(path)).size;
    }
  };
  await walk(output);
  console.log(`输出：${output}`);
  console.log(`模块文件 ${totalModules} 个，页图 ${totalPages} 张，总计 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  if (totalModules === 0) fail("没有复制到任何模块文件");
}

main().catch((error) => {
  console.error(`范本集合整理失败：${error.message}`);
  process.exit(1);
});
