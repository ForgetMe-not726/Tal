/**
 * 把两本语法书的正文按**语法点**整理成生成可用的参考知识库。
 *
 * 用法：node --experimental-strip-types scripts/build-grammar-reference.mjs [--check]
 *
 * 为什么写成脚本而不是手抄：书会换版、语法点会增补，手抄一遍就再也对不上。
 * 转换是**机械**的：页码由书里自己的单元/章节标记定位，内容只做清洗与归类，不补书里没有的规则。
 *
 * 交付形态（`resources/knowledge/grammar/`）与审校 skill 的 `grammar-review.md` 同一形式：
 * 按语法点分节、标注来源与页码。**不做全文复制**——`resources/` 随安装包分发，
 * 整本复制商业语法书有许可问题；需要核对原文时按页码回到书上。
 *
 * 语法点的划分与书目映射沿用 `grammar-review.md` §3「快速定位」那张表：
 * 它是既有产物、已经写明每个语法点对应哪本书的哪些单元，重复维护一份只会两边漂移。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const GRAMMAR_DIR = "D:/Tal internship/SKILL/grammar";
const OUT_DIR = "resources/knowledge/grammar";
const REVIEW_DOC = "resources/knowledge/review-standards/grammar-review.md";

/** 只处理有可用文本层的两本；扫描件（剑桥 PET 语法、朗文）要 OCR，留给下一批。 */
const BOOKS = {
  egiu: {
    file: "English_Grammar_in_Use_Intermediate_5th-Ed (2019).pdf",
    title: "English Grammar in Use",
    citation: "Raymond Murphy, English Grammar in Use, 5th ed., Cambridge University Press, 2019",
  },
  fltrp: {
    file: "外研社-英语语法大全.pdf",
    title: "外研社英语语法大全",
    citation: "蔡菲、何文忠主编《外研社英语语法大全》，外语教学与研究出版社",
  },
};

// ---------------------------------------------------------------------------
// 取文本：用项目已有的 venv（pypdfium2），与 lib/ocr/pages.ts 同一套路
// ---------------------------------------------------------------------------

function pythonPath() {
  const venv = process.env.MINERU_PYTHON?.trim();
  if (venv) return venv;
  const win = join(homedir(), ".venvs", "mineru", "Scripts", "python.exe");
  return existsSync(win) ? win : join(homedir(), ".venvs", "mineru", "bin", "python");
}

const DUMP_SCRIPT = [
  "import sys, json, io",
  "import pypdfium2 as pdfium",
  "doc = pdfium.PdfDocument(sys.argv[1])",
  "pages = []",
  "for i in range(len(doc)):",
  "    try:",
  "        t = doc[i].get_textpage().get_text_range() or ''",
  "    except Exception:",
  "        t = ''",
  "    pages.append(t)",
  "io.open(sys.argv[2], 'w', encoding='utf-8').write(json.dumps(pages))",
].join("\n");

/** 把整本书逐页导出成 `[{page, text}]`（0 起页码），缓存到临时目录，重跑不重复抽。 */
function dumpPages(key) {
  const out = join(tmpdir(), `grammar-${key}.json`);
  if (!process.argv.includes("--force") && existsSync(out)) {
    return JSON.parse(readFileSync(out, "utf8"));
  }
  execFileSync(pythonPath(), ["-I", "-c", DUMP_SCRIPT, join(GRAMMAR_DIR, BOOKS[key].file), out], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(readFileSync(out, "utf8"));
}

// ---------------------------------------------------------------------------
// 页码定位：不解析目录，直接扫每页正文里的单元/章节标记
//
// 目录页本身有 OCR 噪声（编号被拆成 `4.3 .1.l`），而正文里的标记干净得多，
// 而且「标记出现在哪一页」正是我们要的映射。
// ---------------------------------------------------------------------------

/**
 * EGIU：每单元固定「左页讲解 + 右页练习」，讲解页在 PDF 里是等差页（步长 2）。
 *
 * 不能只按页面上出现的 `Unit N` 取**第一个**命中页：书里有交叉引用页
 * （实测 `should 1 ➜ Unit 33` 这种页眉），会把单元指到几十页之外。
 * 改为先用命中页反推公差，再按公差算每一单元的讲解页——书的版式本来就是固定的。
 */
export function egiuUnitPages(pages) {
  const hits = [];
  for (let i = 0; i < pages.length; i += 1) {
    const head = pages[i].split("\n").slice(0, 4).join(" ");
    const match = /Unit\s+(\d+)/.exec(head);
    if (!match) continue;
    // 练习页也带 `Unit N`；讲解页才收（练习页首行有 Exercises）
    if (/Exercises/.test(head)) continue;
    const unit = Number(match[1]);
    if (unit < 1 || unit > 200) continue;
    hits.push({ unit, page: i, offset: i - 2 * unit });
  }
  if (hits.length === 0) return new Map();

  // 取众数作为公差：交叉引用页是少数，众数稳
  const counts = new Map();
  for (const hit of hits) counts.set(hit.offset, (counts.get(hit.offset) ?? 0) + 1);
  const [offset] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const byUnit = new Map();
  for (let unit = 1; unit <= 200; unit += 1) {
    const page = 2 * unit + offset;
    if (page < 0 || page >= pages.length) continue;
    byUnit.set(unit, page);
  }
  return byUnit;
}

/**
 * 外研社：**用书自己的目录**取章节起始页。
 *
 * 这本是扫描件，正文里的结构标记不可靠——实测按正文标记取章首页会错位
 * （GR22 被撑到 62 KB、GR18/GR19 只剩一行）。目录页反而是干净的：
 * 每行就是 `<章节号> <标题> <页码>`。所以目录取章节页码，正文页码用页脚定位。
 */
export function fltrpChapterStarts(tocText) {
  const starts = new Map();
  for (const raw of tocText.split("\n")) {
    const line = raw.trim();
    const match = /^([\d.l]+)\s+.+?\s+(\d{1,4})$/.exec(line);
    if (!match) continue;
    // 扫描件的 OCR 常把数字 1 认成小写 l（`7.2.l`、`18.2.3.6. l`）
    const chapter = Number(match[1].replace(/l/g, "1").split(".")[0]);
    const page = Number(match[2]);
    if (!Number.isFinite(chapter) || chapter < 1 || chapter > 40) continue;
    if (!starts.has(chapter) || page < starts.get(chapter)) starts.set(chapter, page);
  }
  return starts;
}

/**
 * 正文页的**印刷页码 → PDF 索引**偏移：页脚那个独立数字就是印刷页码。
 * 取众数（有页没有页码、或有别的数字），实测这本是 34、EGIU 是 3。
 */
export function printedPageOffset(pages, from = 40) {
  const counts = new Map();
  for (let i = from; i < pages.length; i += 1) {
    const lines = pages[i].split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3);
    const printed = lines.find((line) => /^\d{1,4}$/.test(line));
    if (!printed) continue;
    const delta = i - Number(printed);
    counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 0;
}

/** 把「章 → 印刷页码」换算成「章 → PDF 页范围」。 */
export function fltrpChapterRanges(starts, offset, pageCount) {
  const sorted = [...starts.entries()]
    .map(([chapter, printed]) => ({ chapter, start: printed + offset }))
    .filter((item) => item.start >= 0 && item.start < pageCount)
    .sort((a, b) => a.start - b.start);
  const ranges = new Map();
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    ranges.set(current.chapter, { start: current.start, end: sorted[index + 1]?.start ?? pageCount });
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// 语法点映射：直接读 grammar-review.md §3 的「快速定位」表
// ---------------------------------------------------------------------------

/** 从审校索引里读出 `GR01 | 主题 | 检索词 | EGIU 49–52, 109–112；PET 23–24；Longman 1, 9–10；大全 2, 7, 18, 20, 22`。 */
export function parseGrammarPoints(markdown) {
  const points = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const id = cells[1];
    if (!/^GR\d{2}$/.test(id)) continue;
    const mapping = cells[4] ?? "";
    const egiu = /EGIU\s+([0-9–\-,\s]+)/.exec(mapping)?.[1] ?? "";
    const fltrp = /大全\s+([0-9,，\s]+)/.exec(mapping)?.[1] ?? "";
    points.push({
      id,
      topic: cells[2],
      keywords: cells[3],
      egiuUnits: expandRanges(egiu),
      fltrpChapters: expandRanges(fltrp),
    });
  }
  return points;
}

/** `49–52, 109–112` / `2, 7, 18` → `[49,50,51,52,109,...]`。 */
export function expandRanges(text) {
  const out = [];
  for (const part of text.split(/[,，]/)) {
    const range = /(\d+)\s*[–\-~]\s*(\d+)/.exec(part);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n += 1) out.push(n);
      continue;
    }
    const single = /(\d+)/.exec(part);
    if (single) out.push(Number(single[1]));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 清洗：把页眉页脚、页码、目录残留去掉
// ---------------------------------------------------------------------------

export function cleanPage(text, options = {}) {
  const lines = text.split("\n").map((line) => line.replace(/\s+$/u, ""));
  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (kept.length > 0 && kept.at(-1) !== "") kept.push("");
      continue;
    }
    if (/^\d{1,4}$/.test(line)) continue; // 纯页码
    if (/^(Unit|Exercises)\s*\d*$/i.test(line)) continue; // 页眉
    if (/^English Grammar in Use$/i.test(line)) continue;
    if (/^\d+(\.\d+)*\s+\S/.test(line) && options.dropNumberedHeadings) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function build() {
  const reviewDoc = readFileSync(REVIEW_DOC, "utf8");
  const points = parseGrammarPoints(reviewDoc);
  if (points.length === 0) throw new Error("没能从审校索引里解析出语法点");

  const egiuPages = dumpPages("egiu");
  const fltrpPages = dumpPages("fltrp");
  const egiuUnits = egiuUnitPages(egiuPages);
  const fltrpToc = fltrpPages.slice(6, 36).join("\n");
  const fltrpOffset = printedPageOffset(fltrpPages);
  const fltrpChapters = fltrpChapterRanges(fltrpChapterStarts(fltrpToc), fltrpOffset, fltrpPages.length);

  console.log(`语法点 ${points.length} 个`);
  console.log(`EGIU 定位到 ${egiuUnits.size} 个单元讲解页（共 ${egiuPages.length} 页）`);
  console.log(
    `外研社 目录解析出 ${fltrpChapters.size} 章的页范围（页偏移 ${fltrpOffset}，共 ${fltrpPages.length} 页）`,
  );

  if (process.argv.includes("--probe")) {
    const sample = points.find((point) => point.id === "GR11") ?? points[0];
    console.log(`\n样例 ${sample.id} ${sample.topic}`);
    console.log(`  EGIU 单元 ${sample.egiuUnits.join(",")} → 页 ${sample.egiuUnits.map((u) => egiuUnits.get(u)).join(",")}`);
    console.log(`  大全 章 ${sample.fltrpChapters.join(",")} → ${sample.fltrpChapters.map((c) => { const r = fltrpChapters.get(c); return r ? `p${r.start + 1}–${r.end}` : "?"; }).join(", ")}`);
    const first = sample.egiuUnits.map((u) => egiuUnits.get(u)).find((p) => p != null);
    if (first != null) console.log(`\n--- EGIU p${first} ---\n${cleanPage(egiuPages[first]).slice(0, 600)}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  const missing = [];
  for (const point of points) {
    const rendered = renderPoint(point, { egiuPages, egiuUnits, fltrpPages, fltrpChapters });
    if (!rendered) {
      missing.push(point.id);
      continue;
    }
    const file = `${point.id}-${safeName(point.topic)}.md`;
    writeFileSync(join(OUT_DIR, file), rendered.content, "utf8");
    written.push({
      id: point.id,
      topic: point.topic,
      file,
      sources: rendered.sources,
      chars: rendered.content.length,
    });
  }

  // 机器可读的索引：生成/建议按大纲语法写法取文件，不靠文件名模糊匹配
  writeFileSync(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify(
      {
        generator: "scripts/build-grammar-reference.mjs",
        points: written.map(({ id, topic, file, sources }) => ({ id, topic, file, sources })),
        labels: Object.fromEntries(GRAMMAR_LABEL_MAP),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const stats = {
    egiuUnits: egiuUnits.size,
    egiuPages: egiuPages.length,
    fltrpChapters: fltrpChapters.size,
    fltrpPages: fltrpPages.length,
    fltrpOffset,
  };
  writeFileSync(join(OUT_DIR, "README.md"), renderReadme(points, written, stats), "utf8");

  console.log(`写出 ${written.length} 个语法点文件 → ${OUT_DIR}`);
  if (missing.length > 0) {
    console.warn(`⚠ 这些语法点取不到来源、未写出：${missing.join("、")}`);
  }
  // 自检：语法点不能大面积落空（落空说明映射或页码定位坏了）
  if (missing.length > points.length / 4) {
    throw new Error(`有 ${missing.length}/${points.length} 个语法点取不到来源，先修映射`);
  }
}

function safeName(topic) {
  return topic.replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
}

/**
 * 大纲「语法」列里的写法 → 语法点。
 *
 * 大纲写的是人话（「反义疑问句」「同级比较：as...as」），不是 GR 编号；
 * 这张表就是两者之间的桥。按**子串**匹配——大纲里一个语法点常写好几行。
 * 新增大纲写法时在这里补一行即可（`scripts/test-grammar-reference.mjs` 会检查映射有没有落空）。
 */
export const GRAMMAR_LABEL_MAP = [
  ["反义疑问句", "GR11"],
  ["附加疑问", "GR11"],
  ["反身代词", "GR03"],
  ["非人称被动", "GR09"],
  ["被动语态", "GR09"],
  ["have/get sth. done", "GR09"],
  ["比较级", "GR04"],
  ["最高级", "GR04"],
  ["同级比较", "GR04"],
];

/** 大纲里的语法写法 → 语法点编号；认不出返回 null（不猜）。 */
export function resolveGrammarLabel(text) {
  if (!text) return null;
  for (const [label, id] of GRAMMAR_LABEL_MAP) {
    if (text.includes(label)) return id;
  }
  return null;
}

function renderReadme(points, written, stats) {
  return [
    "# 语法参考（生成用）",
    "",
    "> 由 `scripts/build-grammar-reference.mjs` 从语法书机械整理，**不要手改**——改脚本再重跑。",
    "",
    "## 这是什么",
    "",
    "写教材时给模型的**参考知识库**：每个语法点一份 md，内容是来源书里对应单元/章节的正文，",
    "标注书名与页码，需要核对时按页码回书。它**不是判据**——判据在 `review-standards/`。",
    "",
    "**只做整理，不做全文复制**：`resources/` 随安装包分发，整本复制商业语法书有许可问题",
    "（口径见 question.md）。",
    "",
    "## 来源与取舍",
    "",
    "| 来源 | 采用 | 说明 |",
    "| --- | --- | --- |",
    "| English Grammar in Use, 5th ed.（Cambridge, 2019） | 单元级讲解页 | 一个单元一页、正好讲一个点，最精确 |",
    "| 外研社英语语法大全（外研社） | 章级 | 章节宽、且是扫描件的 OCR 层（约 95–99% 可读）；**只在 EGIU 没覆盖的语法点补入**（GR19–GR22） |",
    "",
    "不采用：练习题与答案页、页眉页脚、目录页、前置页。",
    "",
    "## 语法点",
    "",
    "| GR | 主题 | 来源 |",
    "| --- | --- | --- |",
    ...written.map(
      (item) => `| ${item.id} | ${item.topic} | ${item.sources.length} 段 · ${item.chars} 字符 |`,
    ),
    "",
    "## 大纲语法写法 → 语法点",
    "",
    "| 大纲里的写法 | 语法点 |",
    "| --- | --- |",
    ...GRAMMAR_LABEL_MAP.map(([label, id]) => `| ${label} | ${id} |`),
    "",
    "生成/建议按**本课大纲的语法字段**取对应文件，只带那一个点，不整库塞进 Prompt。",
    "认不出的写法不猜——如实记进资料缺口。",
    "",
    "## 统计",
    "",
    `- 语法点 ${points.length} 个，写出 ${written.length} 个文件`,
    `- EGIU 定位到 ${stats.egiuUnits} 个单元讲解页（全书 ${stats.egiuPages} 页）`,
    `- 外研社 目录解析出 ${stats.fltrpChapters} 章的页范围（全书 ${stats.fltrpPages} 页，页偏移 ${stats.fltrpOffset}）`,
    "",
  ].join("\n");
}

/**
 * 一个语法点的 md：来源与页码 + 按来源整理的正文。
 *
 * **来源取舍**：EGIU 是单元级的，一个单元就是一页、正好讲一个点；外研社是章级的，
 * 一章动辄几十页（实测把 GR01 撑到 278 KB），整章并进来就不再是"参考"而是"搬书"。
 * 所以以 EGIU 为主，**只有 EGIU 没覆盖的语法点才用外研社补**（GR19–GR22 的否定、
 * 倒装、语域、标点）。外研社的章节映射仍写在 README 里，需要时按章回书。
 */
export function renderPoint(point, ctx) {
  const sections = [];
  for (const unit of point.egiuUnits) {
    const page = ctx.egiuUnits.get(unit);
    if (page == null) continue;
    const body = cleanPage(ctx.egiuPages[page]);
    if (body.length < 40) continue;
    sections.push({ source: `English Grammar in Use · Unit ${unit} · p.${page + 1}`, body });
  }
  if (sections.length === 0) {
    for (const chapter of point.fltrpChapters) {
      const range = ctx.fltrpChapters.get(chapter);
      if (!range) continue;
      const body = ctx.fltrpPages
        .slice(range.start, range.end)
        .map((text) => cleanPage(text))
        .filter((text) => text.length >= 40)
        .join("\n\n");
      if (body.length < 40) continue;
      sections.push({
        source: `外研社英语语法大全 · 第 ${chapter} 章 · p.${range.start + 1}–${range.end}`,
        body,
      });
    }
  }
  if (sections.length === 0) return null;
  const content = [
    `# ${point.id} ${point.topic}`,
    "",
    `> 检索词：${point.keywords}`,
    "> 本文件是**生成参考**，不是判据：写教材时对照它的形式、意义、使用条件与常见错误。",
    "> 内容按来源整理、标注页码；**只写来源支持的内容**，需要核对原文时按页码回书。",
    "",
    "## 来源",
    "",
    ...sections.map((section) => `- ${section.source}`),
    "",
    ...sections.flatMap((section) => [`## ${section.source}`, "", section.body, ""]),
  ].join("\n");
  return { content, sources: sections.map((section) => section.source) };
}

build();
