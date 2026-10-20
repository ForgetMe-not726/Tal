/**
 * 把一批教材/资料 OCR 后落成知识库里的**一个集合**。
 *
 * 用法：
 *   node --experimental-strip-types scripts/ingest-knowledge-collection.mjs \
 *     --id autumn-2026-l5 --title "2026 秋下 L5 完成版教材" --kind exemplar --grade L5 --term autumn \
 *     --book student=<MinerU 输出目录> --book workbook=<...> --book knowledge=<...>
 *
 * 输入是 MinerU 的输出目录（`<out>/<stem>/ocr/`）；脚本负责：
 *   ① 归一化（content.md / structure.json / 页图 / 资产）→ `<collection>/ocr/<book>/`
 *   ② 按** buku 结构**切成模块 → `<collection>/modules/<bookType>/lesson-NN/<moduleKey>.md`
 *   ③ 写 `<collection>/manifest.json`（书种/课/模块 → 文件、页范围）
 *
 * 为什么按模块切：生成要的是"同书种、同模块"的范本，按结构化键直接取，
 * 不做整本 PDF 的朴素 RAG（profile §6.2）。
 *
 * 为什么用 `MODULE_DIRECTORY.heading` 切：模块标题是项目已经维护好的数据
 * （"Let's say!" / "Day 1" …），在这里硬编码一份只会两边漂移。
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildContentMarkdown, buildStructure, structureWarnings } from "../lib/ocr/normalize.ts";
import { locateUpstream, mineruPython } from "../lib/ocr/mineru.ts";
import { DEFAULT_PAGE_IMAGE, renderPageImages } from "../lib/ocr/pages.ts";
import { htmlTablesToMarkdown } from "../lib/markdown/html-tables.ts";
import { MODULE_DIRECTORY } from "../lib/modules/directory.ts";
import { collectionsRoot } from "../lib/knowledge/collections.ts";

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function args() {
  const out = { books: {} };
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq < 0) continue;
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    // `--book=student=<MinerU 输出目录>`
    if (key === "book") {
      const inner = value.indexOf("=");
      if (inner > 0) out.books[value.slice(0, inner)] = value.slice(inner + 1);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 切分：按课 + 模块标题
// ---------------------------------------------------------------------------

const LESSON_HEADING = /^#{1,6}\s*(?:Unit|Lesson)\s+(\d+)\b[ \t]*(.*)$/iu;
const ANY_HEADING = /^#{1,6}\s+(.+)$/u;
/**
 * 书末的**附录类**标题：看到它就结束本课并停止收集。
 *
 * 实测知识清单的第 53 页起是 "BASICS: B2 First"（附录 I）与 Ideas Bank（附录 II），
 * OCR 没有给它们单独的目录标记，若不断开会被并进最后一课的最后一个模块，
 * 把 13 KB 的附录当成 lets_talk 的范本喂给模型。
 */
const APPENDIX_HEADING =
  /^(?:appendix|appendices|附录|basics\s*[:：]|ideas\s+bank|answer\s+key|参考答案|word\s+list)/iu;

function normalizeHeading(value) {
  return value
    .replace(/[\s ]+/gu, " ")
    .replace(/[!！:：.。,，]+$/u, "")
    .trim()
    .toLocaleLowerCase();
}

/** 模块标题 → moduleKey（只认该 bookType 的目录）。 */
function moduleHeadings(bookType) {
  return MODULE_DIRECTORY
    // 有的模块没有正文标题（如知识清单的「学习目标」由表格承载），它们不参与分节
    .filter((item) => item.bookType === bookType && typeof item.heading === "string" && item.heading.trim())
    .map((item) => ({ ...item, normalized: normalizeHeading(item.heading) }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 把**页眉里的模块标题**提升成正文标题。
 *
 * 实测学生用书的 `Let's say!` 只出现在页眉（p9 起），正文里没有对应标题；
 * 归一化会丢掉页眉，于是这一模块的内容被并进上一个模块（第 9 课因此缺 say）。
 * 只在**标题变化**时提升一次：同一节的页眉会在每页重复，条条提升会把顺序搅乱。
 *
 * 纯函数，便于单测。
 */
export function promoteSectionHeaders(contentList, bookType) {
  const headings = new Set(moduleHeadings(bookType).map((item) => item.normalized));
  let last = null;
  return contentList.map((block) => {
    if (block.type !== "header" && block.type !== "footer") return block;
    const text = (block.text ?? "").trim();
    if (!text) return block;
    const normalized = normalizeHeading(text);
    if (!headings.has(normalized)) return block;
    if (normalized === last) return block;
    last = normalized;
    return { ...block, type: "text", text_level: 1, text };
  });
}

/**
 * 把整本书的 Markdown 切成「课 → 模块」。
 *
 * 规则：
 * - `# Unit N` / `Lesson N ...` 是课边界（`buildPagedMarkdown` 会按页脚课号补 `# Unit N`）；
 * - 模块标题命中的那一行是模块边界；**第一个模块标题之前的内容**归本课 sortOrder 最小的模块
 *   （知识清单的「学习目标」表就是这样，它没有自己的标题）；
 * - 页码取该模块覆盖到的 `<!-- page N -->` 范围。
 *
 * 纯函数，便于单测。
 */
export function chunkTextbook(markdown, bookType) {
  const headings = moduleHeadings(bookType);
  const byHeading = new Map(headings.map((item) => [item.normalized, item]));
  const first = headings[0] ?? null;

  /**
   * 标题匹配：先精确，再**前缀**。
   *
   * OCR 会把长标题截断（实测 `In this lesson, we will...` 变成 `In this lesson, we wil...`），
   * 纯精确匹配会让那一课切不开、内容并到上一课。前缀要求 ≥12 字符，避免短标题互相吞并。
   */
  const matchHeading = (text) => {
    const normalized = normalizeHeading(text);
    const exact = byHeading.get(normalized);
    if (exact) return exact;
    if (normalized.length < 12) return null;
    return (
      headings.find(
        (item) => item.normalized.startsWith(normalized) || normalized.startsWith(item.normalized),
      ) ?? null
    );
  };

  const lessons = [];
  let lesson = null;
  let current = null;
  let page = null;
  // 目录里的课：`Lesson N 标题 [页码]`，按出现顺序保存（正文的课号常常残缺，见下）
  const tocEntries = [];
  const tocTitles = new Map();
  let seenBody = false;
  let tocCursor = 0;
  // 学习目标模块：每课开头都有它。正文的 `# Unit N` 缺失时用它切课（实测学生用书就是这样）
  const objectivesKey = headings.find((item) => item.moduleKey === "learning_objectives")?.moduleKey ?? null;

  const nextLessonIdentity = () => {
    const entry = tocEntries[tocCursor];
    tocCursor += 1;
    return entry
      ? { number: entry.number, title: entry.title }
      : { number: (lessons.at(-1)?.lessonNumber ?? 0) + 1, title: "" };
  };
  // 只算**正文模块**：学习目标模块自己那几行（"In this lesson, we will..."）不算，
  // 否则紧接着又出现一个学习目标标题时会多切出一课（实测学生用书会多出第 16 课）。
  const lessonHasContent = () =>
    lesson != null &&
    [...lesson.modules.values()].some(
      (item) => item.entry.moduleKey !== objectivesKey && item.lines.some((line) => line.trim()),
    );

  const openLesson = (number, title) => {
    lesson = { lessonNumber: number, title: title.trim(), modules: new Map() };
    lessons.push(lesson);
  };

  const openModule = (entry) => {
    if (!lesson) return;
    const key = `${lesson.lessonNumber}/${entry.moduleKey}`;
    if (!lesson.modules.has(key)) {
      lesson.modules.set(key, { entry, lines: [], pages: [null, null] });
    }
    current = lesson.modules.get(key);
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/\s+$/u, "");
    const trimmed = line.trim();

    const pageMarker = /^<!-- page (\d+) -->$/u.exec(trimmed);
    if (pageMarker) {
      page = Number(pageMarker[1]);
      // 标记保留在模块正文里：检索要按它定位命中页，生成时再剥掉
      if (current) current.lines.push(trimmed);
      continue;
    }

    // 附录开始：结束当前课，后面的内容不再收
    if (ANY_HEADING.test(trimmed) && APPENDIX_HEADING.test(ANY_HEADING.exec(trimmed)[1].trim())) {
      lesson = null;
      current = null;
      continue;
    }

    // 正文开始前的目录行：`Lesson 9 The next step`
    if (!seenBody) {
      const tocLine = /^\s*Lesson\s+(\d+)\s+(.+?)\s*$/iu.exec(trimmed);
      if (tocLine) {
        const number = Number(tocLine[1]);
        const title = tocLine[2].replace(/[.…·\s]+\d+\s*$/u, "").trim();
        tocTitles.set(number, title);
        if (!tocEntries.some((item) => item.number === number)) tocEntries.push({ number, title });
        continue;
      }
    }

    const lessonMatch = LESSON_HEADING.exec(trimmed);
    if (lessonMatch) {
      seenBody = true;
      // 有目录就以目录顺序为准：正文标题的课号常常残缺或被 OCR 粘连
      // （实测「Lesson The next step」没号、「2Sports Unite!」号在前），两套编号混用会错位。
      const explicit = Number(lessonMatch[1]);
      const identity =
        tocEntries.length > 0
          ? nextLessonIdentity()
          : { number: explicit, title: (lessonMatch[2] ?? "").trim() || tocTitles.get(explicit) || "" };
      const title = identity.title || (lessonMatch[2] ?? "").trim() || tocTitles.get(identity.number) || "";
      openLesson(identity.number, title);
      current = null;
      // 本课还没有模块时，后续无标题内容归第一个模块
      if (first) openModule(first);
      continue;
    }

    const heading = ANY_HEADING.exec(trimmed);
    if (heading) {
      const entry = matchHeading(heading[1]);
      if (entry) {
        // 学习目标（`In this lesson, we will...`）每课开头一次：正文没有课标题时用它切课
        if (entry.moduleKey === objectivesKey && (lesson == null || lessonHasContent())) {
          const identity = nextLessonIdentity();
          openLesson(identity.number, identity.title);
        }
        openModule(entry);
        continue;
      }
    }

    if (!current || !trimmed) continue;
    current.lines.push(line);
    if (page != null) {
      if (current.pages[0] == null || page < current.pages[0]) current.pages[0] = page;
      if (current.pages[1] == null || page > current.pages[1]) current.pages[1] = page;
    }
  }

  return lessons
    .map((item) => ({
      lessonNumber: item.lessonNumber,
      title: item.title,
      modules: [...item.modules.values()]
        .map((module) => ({
          moduleKey: module.entry.moduleKey,
          pages: module.pages[0] == null ? null : module.pages,
          text: module.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
        }))
        .filter((module) => module.text.length > 0),
    }))
    .filter((item) => item.modules.length > 0);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function ingestBook(input) {
  const { collectionDir, bookType, ocrRoot } = input;
  const upstream = await locateUpstream(ocrRoot, "ocr");
  const rawContentList = await readJson(upstream.contentListPath);
  const middle = await readJson(upstream.middlePath);
  const contentList = promoteSectionHeaders(rawContentList, bookType);

  const structure = buildStructure({ jobId: `${bookType}`, contentList, middle });
  const markdown = buildContentMarkdown(contentList);
  const warnings = structureWarnings(structure, contentList);

  const bookDir = join(collectionDir, "ocr", bookType);
  await mkdir(bookDir, { recursive: true });
  await writeFile(join(bookDir, "content.md"), markdown, "utf8");
  await writeFile(join(bookDir, "structure.json"), JSON.stringify(structure), "utf8");

  // 原件：MinerU 会带一份 `_origin.pdf`（按页区间切过），复制进集合供回看
  let original = "";
  if (upstream.originPdfPath) {
    original = basename(upstream.originPdfPath).replace(/_origin\.pdf$/u, ".pdf");
    await cp(upstream.originPdfPath, join(bookDir, "original.pdf"));
  }

  // 页图：引擎不产出整页图，自己渲染（参数进 manifest，可重建）
  let pageImages = 0;
  if (upstream.originPdfPath) {
    try {
      const rendered = await renderPageImages({
        pythonExe: mineruPython(),
        pdfPath: upstream.originPdfPath,
        outDir: join(bookDir, "pages"),
        options: DEFAULT_PAGE_IMAGE,
      });
      pageImages = rendered.pageCount;
    } catch (error) {
      warnings.push(`页图渲染失败：${error.message}`);
    }
  }

  if (upstream.imagesDir && existsSync(upstream.imagesDir)) {
    await cp(upstream.imagesDir, join(bookDir, "assets"), { recursive: true }).catch(() => undefined);
  }

  await writeFile(
    join(bookDir, "manifest.json"),
    JSON.stringify(
      {
        bookType,
        original,
        pageCount: structure.pageCount,
        pageImages,
        pageImage: DEFAULT_PAGE_IMAGE,
        assets: Boolean(upstream.imagesDir),
        warnings,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  // 按模块切分并落盘（表格转 Markdown：生成的 Prompt 不许出现 HTML 表格）
  const lessons = chunkTextbook(markdown, bookType).map((lesson) => ({
    lessonNumber: lesson.lessonNumber,
    title: lesson.title,
    modules: lesson.modules.map((chunk) => {
      const file = `modules/${bookType}/lesson-${String(lesson.lessonNumber).padStart(2, "0")}/${chunk.moduleKey}.md`;
      return { ...chunk, file };
    }),
  }));
  for (const lesson of lessons) {
    for (const chunk of lesson.modules) {
      const target = join(collectionDir, chunk.file);
      await mkdir(join(target, ".."), { recursive: true });
      const header = [
        `<!-- 来源：${original || bookType} · Lesson ${lesson.lessonNumber} ${lesson.title} · ${chunk.moduleKey} -->`,
        chunk.pages ? `<!-- pages: ${chunk.pages[0]}–${chunk.pages[1]} -->` : "",
      ].join("\n");
      await writeFile(target, `${header}\n${htmlTablesToMarkdown(chunk.text)}\n`, "utf8");
    }
  }

  return {
    bookType,
    original,
    ocrDir: `ocr/${bookType}`,
    pageCount: structure.pageCount,
    lessons: lessons.map((lesson) => ({
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      modules: lesson.modules.map((chunk) => ({
        moduleKey: chunk.moduleKey,
        file: chunk.file,
        pages: chunk.pages,
      })),
    })),
  };
}

async function main() {
  const options = args();
  const required = ["id", "title", "kind", "grade", "term"];
  for (const key of required) {
    if (!options[key]) throw new Error(`缺少参数 --${key}`);
  }
  const bookings = Object.entries(options.books);
  if (bookings.length === 0) throw new Error("至少给一个 --book <bookType>=<MinerU 输出目录>");

  const collectionDir = join(collectionsRoot(), options.id);
  if (existsSync(collectionDir) && !process.argv.includes("--force")) {
    throw new Error(`集合已存在：${collectionDir}（要覆盖加 --force）`);
  }
  await mkdir(collectionDir, { recursive: true });

  const books = [];
  for (const [bookType, dir] of bookings) {
    process.stdout.write(`· ${bookType} ← ${dir}\n`);
    books.push(await ingestBook({ collectionDir, bookType, ocrRoot: dir }));
    const lessonCount = books.at(-1).lessons.length;
    const moduleCount = books.at(-1).lessons.reduce((sum, item) => sum + item.modules.length, 0);
    process.stdout.write(`  → ${books.at(-1).pageCount} 页、${lessonCount} 课、${moduleCount} 个模块\n`);
  }

  const manifest = {
    schemaVersion: 1,
    id: options.id,
    title: options.title,
    kind: options.kind,
    grade: options.grade,
    term: options.term,
    createdAt: new Date().toISOString(),
    generator: "scripts/ingest-knowledge-collection.mjs",
    books,
    license: options.license ?? "",
  };
  await writeFile(join(collectionDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const lessons = books.reduce((sum, book) => sum + book.lessons.length, 0);
  const modules = books.reduce((sum, book) => sum + book.lessons.reduce((n, l) => n + l.modules.length, 0), 0);
  process.stdout.write(`\n集合已写入：${collectionDir}\n  ${books.length} 本书、${lessons} 课、${modules} 个模块\n`);
}

// 只在直接运行时执行（被测试 import 时不跑）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
