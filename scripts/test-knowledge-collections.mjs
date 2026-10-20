import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkTextbook } from "./ingest-knowledge-collection.mjs";
import {
  findExemplars,
  listCollectionManifests,
  listCollectionModules,
  readCollectionChunk,
  renderExemplarBlock,
} from "../lib/knowledge/collections.ts";
import { searchCorpora } from "../lib/assistant/match.ts";

/**
 * 知识库集合：切分、读取、检索。
 *
 * 这一层决定"生成时拿到的范本是不是对的模块"——切错了不会报错，只会悄悄把
 * 附录或别课的内容喂给模型，所以要在离线测试里钉住。
 */

// ---------------------------------------------------------------------------
// 切分
// ---------------------------------------------------------------------------

const SAMPLE = `<!-- page 0 -->
# LEVEL5
Parent's Book

<!-- page 1 -->
Lesson 9 The next step
Lesson 11 Treasure hunt

<!-- page 2 -->
# Unit 9
<table><tr><td>学习目标</td></tr></table>

## Let's say!
<!-- page 3 -->
核心词汇 admission

## Let's read!
<!-- page 4 -->
阅读短文

## Let's talk!
<!-- page 5 -->
语法讲解

<!-- page 6 -->
# Unit 11
## Let's say!
<!-- page 7 -->
核心词汇 treasure

# BASICS: B2 First
<!-- page 8 -->
附录内容不该进范本
`;

function testChunking() {
  const lessons = chunkTextbook(SAMPLE, "knowledge");
  assert.equal(lessons.length, 2, "两课");
  assert.equal(lessons[0].lessonNumber, 9);
  assert.equal(lessons[0].title, "The next step", "课标题从目录补");
  assert.deepEqual(
    lessons[0].modules.map((item) => item.moduleKey),
    ["lets_say", "lets_read", "lets_talk"],
    "按模块标题切分",
  );
  // 第一个模块标题之前的内容（学习目标表）归第一个模块
  assert.match(lessons[0].modules[0].text, /学习目标/u);
  // 页码范围
  assert.deepEqual(lessons[0].modules[0].pages, [2, 3]);
  assert.deepEqual(lessons[0].modules[1].pages, [4, 4]);
  // 附录必须被切掉：不能进最后一课
  const last = lessons.at(-1);
  assert.equal(last.modules.at(-1).moduleKey, "lets_say");
  assert.doesNotMatch(last.modules.at(-1).text, /附录内容不该进范本/u);
  // 页码标记保留（检索要按它定位命中页）
  assert.match(lessons[0].modules[0].text, /<!-- page 3 -->/u);
}

function testChunkingIgnoresUnknownHeadings() {
  const markdown = `# Unit 1
## Let's say!
正文一
## 随便什么标题
正文二
`;
  const lessons = chunkTextbook(markdown, "knowledge");
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].modules.length, 1, "不认识的标题不产生新模块");
  assert.match(lessons[0].modules[0].text, /正文二/u, "未知标题下的内容仍属当前模块");
}

// ---------------------------------------------------------------------------
// 集合读取
// ---------------------------------------------------------------------------

function withCollection(run) {
  const root = mkdtempSync(join(tmpdir(), "collections-"));
  const dir = join(root, "demo");
  mkdirSync(join(dir, "modules", "student", "lesson-01"), { recursive: true });
  writeFileSync(
    join(dir, "modules", "student", "lesson-01", "lets_read.md"),
    "<!-- page 12 -->\n范文正文\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "demo",
      title: "演示集合",
      kind: "exemplar",
      grade: "L5",
      term: "autumn",
      createdAt: "2026-10-20T00:00:00.000Z",
      generator: "test",
      books: [
        {
          bookType: "student",
          original: "demo.pdf",
          ocrDir: "ocr/student",
          pageCount: 20,
          lessons: [
            {
              lessonNumber: 1,
              title: "Demo",
              modules: [
                { moduleKey: "lets_read", file: "modules/student/lesson-01/lets_read.md", pages: [12, 12] },
              ],
            },
          ],
        },
      ],
    }),
    "utf8",
  );
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

async function testCollectionReaders() {
  await withCollection(async (root) => {
    const manifests = await listCollectionManifests(root);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].kind, "exemplar");

    const exemplars = await findExemplars({ bookType: "student", moduleKey: "lets_read", root });
    assert.equal(exemplars.chunks.length, 1);
    assert.equal(exemplars.chunks[0].lessonNumber, 1);
    assert.match(exemplars.chunks[0].text, /范文正文/u);

    // 书种/模块对不上就是空——不猜
    assert.equal((await findExemplars({ bookType: "workbook", moduleKey: "lets_read", root })).chunks.length, 0);
    assert.equal((await findExemplars({ bookType: "student", moduleKey: "lets_say", root })).chunks.length, 0);

    const rows = await listCollectionModules({ bookType: "student", root });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].module.moduleKey, "lets_read");

    // 预算：超了就一份都不取（如实返回 omitted）
    const tight = await findExemplars({ bookType: "student", moduleKey: "lets_read", maxChars: 1, root });
    assert.equal(tight.chunks.length, 0);
    assert.equal(tight.omitted, 1);

    const chunk = await readCollectionChunk(manifests[0], manifests[0].books[0], manifests[0].books[0].lessons[0], manifests[0].books[0].lessons[0].modules[0], root);
    assert.ok(chunk);
    assert.deepEqual(chunk.pages, [12, 12]);
  });
}

/** 集合目录不存在时返回空，不抛错（老工作区还没装集合）。 */
async function testMissingCollectionIsHonest() {
  assert.deepEqual(await listCollectionManifests(join(tmpdir(), "没有这个集合目录")), []);
  assert.deepEqual(await listCollectionModules({ root: join(tmpdir(), "没有这个集合目录") }), []);
}

// ---------------------------------------------------------------------------
// 助手检索：范本
// ---------------------------------------------------------------------------

function testAssistantSearchesExemplars() {
  const base = {
    projects: [{ id: "p1" }],
    lessons: [],
    entries: [],
    rules: [],
    versions: [],
    references: [],
    collectionDocs: [
      {
        collectionId: "autumn-2026-l5",
        collectionTitle: "2026 秋下 L5 完成版教材",
        bookType: "student",
        lessonNumber: 9,
        lessonTitle: "The next step",
        moduleKey: "lets_read",
        pages: [12, 14],
        text: "<!-- page 12 -->\n阅读短文 admission\n<!-- page 13 -->\n更多内容",
      },
    ],
    collectionTotal: 1,
  };
  const result = searchCorpora(base, { query: "admission", scope: "workspace" });
  const hit = result.hits.find((item) => item.kind === "exemplar");
  assert.ok(hit, "范本教材要能被搜到");
  assert.equal(hit.lessonNumber, 9);
  assert.equal(hit.moduleKey, "lets_read");
  assert.equal(hit.pageIndex, 12, "按页码标记定位命中页");
  assert.match(hit.pageImageUrl ?? "", /p0012\.jpg$/u);
  assert.equal(result.searched.exemplars, 1);
}

/**
 * 范本进 Prompt 的写法：带来源与页码，注释剥掉；没有范本时明说。
 */
function testExemplarBlock() {
  const chunk = {
    collectionId: "autumn",
    collectionTitle: "2026 秋下 L5 完成版教材",
    kind: "exemplar",
    bookType: "student",
    lessonNumber: 9,
    lessonTitle: "The next step",
    moduleKey: "lets_read",
    pages: [12, 17],
    text: "<!-- 来源：demo.pdf -->\n<!-- page 12 -->\n正文",
  };
  const block = renderExemplarBlock([chunk], (text) => text);
  assert.match(block, /2026 秋下 L5 完成版教材/u);
  assert.match(block, /Lesson 9 The next step/u);
  assert.match(block, /p\.13–18/u, "页码按 1 起显示");
  assert.match(block, /正文/u);
  assert.doesNotMatch(block, /<!--/u, "溯源注释不进 Prompt");

  const empty = renderExemplarBlock([], (text) => text);
  assert.match(empty, /还没有同模块的范本/u);
}

const tests = [
  ["按课与模块切分，附录被切掉", testChunking],
  ["不认识的标题不产生模块", testChunkingIgnoresUnknownHeadings],
  ["集合读取：范本按书种/模块取，预算生效", testCollectionReaders],
  ["集合不存在时如实返回空", testMissingCollectionIsHonest],
  ["助手能搜到范本并定位到页", testAssistantSearchesExemplars],
  ["范本进 Prompt：带来源页码、注释剥掉", testExemplarBlock],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`知识库集合测试通过:${tests.length} 项`);
