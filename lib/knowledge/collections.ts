/**
 * 知识库的**资料集合**（collection）：一次投入的一批资料。
 *
 * 为什么需要它：知识库原来只有两个手写的特例目录（`grammar/`、`review-standards/`），
 * 再加"完成版教材"和"大量剑桥内容"就会变成第三、第四个特例。集合把"一次投入的一批资料"
 * 变成同一种东西：一个目录 + 一个 manifest，内容按**书种 / 课 / 模块**切好。
 *
 * 目录结构（`<ws>/knowledge/collections/<id>/`）：
 *
 * ```text
 * manifest.json                       批次元数据 + 索引（书种/课/模块 → 文件、页范围）
 * ocr/<book>/                         OCR 产物：content.md / structure.json / pages/ / assets/
 * modules/<bookType>/lesson-NN/<key>.md   按模块切好的正文（带 <!-- page N --> 页码标记）
 * ```
 *
 * 两条设计纪律：
 * 1. **文件是事实源，manifest 是索引**——manifest 可以按文件和 OCR 产物重建，
 *    删掉不丢内容（profile §3：索引不能成为唯一事实源）。
 * 2. **按结构化键取用**：生成要"同书种、同模块"的范本，直接按路径取，不扫全文
 *    （profile §6.2：Structured Retrieval 优先，不做整本 PDF 的朴素 RAG）。
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BookType } from "@/lib/db/types";
import { knowledgeDir } from "../workspace/paths.ts";

export const COLLECTIONS_DIR_NAME = "collections";

/** 集合的性质。决定它能被谁、以什么优先级使用。 */
export type CollectionKind =
  /** 已定稿的新版教材：**范本**，生成时照着写。 */
  | "exemplar"
  /** Cambridge 官方大纲、CEFR、词表等权威资料。 */
  | "cambridge"
  /** 其他参考（真题、教辅、教研说明）。 */
  | "reference";

export const COLLECTION_KIND_LABEL: Record<CollectionKind, string> = {
  exemplar: "范本教材",
  cambridge: "剑桥权威资料",
  reference: "参考资料",
};

export type CollectionModuleEntry = {
  moduleKey: string;
  /** 相对集合根目录的文件路径。 */
  file: string;
  /** 0 起的页范围（含首尾）；没有页码就是 null。 */
  pages: [number, number] | null;
};

export type CollectionLessonEntry = {
  lessonNumber: number;
  title: string;
  modules: CollectionModuleEntry[];
};

export type CollectionBookEntry = {
  bookType: BookType;
  /** 原始文件名（原件存在 `ocr/<book>/original/` 或记录在案）。 */
  original: string;
  /** OCR 产物目录（相对集合根）。 */
  ocrDir: string;
  pageCount: number;
  lessons: CollectionLessonEntry[];
};

export type CollectionManifest = {
  schemaVersion: 1;
  id: string;
  title: string;
  kind: CollectionKind;
  grade: string;
  term: string;
  createdAt: string;
  generator: string;
  books: CollectionBookEntry[];
  /** 许可/分发口径的说明。随包分发的资料必须写清楚。 */
  license?: string;
};

export type CollectionChunk = {
  collectionId: string;
  collectionTitle: string;
  kind: CollectionKind;
  bookType: BookType;
  lessonNumber: number;
  lessonTitle: string;
  moduleKey: string;
  pages: [number, number] | null;
  text: string;
};

export function collectionsRoot(root?: string): string {
  return root ?? join(knowledgeDir(), COLLECTIONS_DIR_NAME);
}

/** 读全部集合的 manifest。目录不存在时返回空数组（老工作区还没装集合）。 */
export async function listCollectionManifests(root?: string): Promise<CollectionManifest[]> {
  const dir = collectionsRoot(root);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const manifests: CollectionManifest[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(join(dir, name, "manifest.json"), "utf8");
      const manifest = JSON.parse(raw) as CollectionManifest;
      if (manifest?.schemaVersion === 1 && Array.isArray(manifest.books)) manifests.push(manifest);
    } catch {
      // 目录不是集合、或 manifest 坏了：跳过，不影响其它集合
    }
  }
  return manifests.sort((a, b) => a.id.localeCompare(b.id));
}

/** 读一个集合里的某个模块正文。取不到返回 null，不抛错。 */
export async function readCollectionChunk(
  manifest: CollectionManifest,
  book: CollectionBookEntry,
  lesson: CollectionLessonEntry,
  module: CollectionModuleEntry,
  root?: string,
): Promise<CollectionChunk | null> {
  try {
    const text = await readFile(join(collectionsRoot(root), manifest.id, module.file), "utf8");
    return {
      collectionId: manifest.id,
      collectionTitle: manifest.title,
      kind: manifest.kind,
      bookType: book.bookType,
      lessonNumber: lesson.lessonNumber,
      lessonTitle: lesson.title,
      moduleKey: module.moduleKey,
      pages: module.pages,
      text,
    };
  } catch {
    return null;
  }
}

/**
 * 找**同书种、同模块**的范本（生成时照着写）。
 *
 * 只取 `exemplar` 集合；按课次排序，最新的集合优先（同一模块可能有多个学期的范本）。
 * 预算是必须的：一个模块正文通常几 KB，但不设上限时多份范本会把 Prompt 挤爆。
 */
export async function findExemplars(input: {
  bookType: BookType;
  moduleKey: string;
  maxChunks?: number;
  maxChars?: number;
  root?: string;
}): Promise<{ chunks: CollectionChunk[]; omitted: number }> {
  const maxChunks = input.maxChunks ?? 2;
  const maxChars = input.maxChars ?? 8000;
  const manifests = (await listCollectionManifests(input.root)).filter((item) => item.kind === "exemplar");

  const candidates: CollectionChunk[] = [];
  for (const manifest of manifests) {
    for (const book of manifest.books) {
      if (book.bookType !== input.bookType) continue;
      for (const lesson of book.lessons) {
        for (const entry of lesson.modules) {
          if (entry.moduleKey !== input.moduleKey) continue;
          const chunk = await readCollectionChunk(manifest, book, lesson, entry, input.root);
          if (chunk) candidates.push(chunk);
        }
      }
    }
  }

  const kept: CollectionChunk[] = [];
  let used = 0;
  for (const chunk of candidates.sort((a, b) => a.lessonNumber - b.lessonNumber)) {
    if (kept.length >= maxChunks) break;
    if (used + chunk.text.length > maxChars) continue;
    kept.push(chunk);
    used += chunk.text.length;
  }
  return { chunks: kept, omitted: candidates.length - kept.length };
}

/**
 * 列出集合里的全部模块（通用助手用）。
 *
 * 可按 kind / 书种 / 课 / 模块过滤；不给过滤就是全量。**只读 manifest 与索引**，
 * 不读正文——调用方按需再读，避免一次把整个知识库读进内存。
 */
export async function listCollectionModules(input: {
  kind?: CollectionKind;
  bookType?: BookType;
  lessonNumber?: number;
  moduleKey?: string;
  root?: string;
} = {}): Promise<
  Array<{
    manifest: CollectionManifest;
    collectionId: string;
    collectionTitle: string;
    kind: CollectionKind;
    book: CollectionBookEntry;
    lesson: CollectionLessonEntry;
    module: CollectionModuleEntry;
  }>
> {
  const manifests = await listCollectionManifests(input.root);
  const rows = [];
  for (const manifest of manifests) {
    if (input.kind && manifest.kind !== input.kind) continue;
    for (const book of manifest.books) {
      if (input.bookType && book.bookType !== input.bookType) continue;
      for (const lesson of book.lessons) {
        if (input.lessonNumber != null && lesson.lessonNumber !== input.lessonNumber) continue;
        for (const entry of lesson.modules) {
          if (input.moduleKey && entry.moduleKey !== input.moduleKey) continue;
          rows.push({
            manifest,
            collectionId: manifest.id,
            collectionTitle: manifest.title,
            kind: manifest.kind,
            book,
            lesson,
            module: entry,
          });
        }
      }
    }
  }
  return rows;
}

/**
 * 范本进生成 Prompt 的写法。**纯函数**，便于单测。
 *
 * 注释（来源/页码）留给检索与溯源，进 Prompt 前剥掉；取不到范本时**明说没有**，
 * 而不是留空让模型自己猜"该长什么样"。
 */
export function renderExemplarBlock(
  chunks: readonly CollectionChunk[],
  convertTables: (text: string) => string,
): string {
  if (chunks.length === 0) return "（知识库里还没有同模块的范本：按输出结构和来源材料写。）";
  return chunks
    .map(
      (item) =>
        `### 范本：${item.collectionTitle} · Lesson ${item.lessonNumber} ${item.lessonTitle} · ${item.moduleKey}` +
        `${item.pages ? `（p.${item.pages[0] + 1}–${item.pages[1] + 1}）` : ""}\n` +
        convertTables(item.text.replace(/^<!--.*?-->\n?/gmu, "")),
    )
    .join("\n\n");
}
