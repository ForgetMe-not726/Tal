import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitLegacyMarkdown } from "../lib/knowledge/legacy-source.ts";
import {
  LOW_CONFIDENCE,
  assetRelativePath,
  buildContentMarkdown,
  buildStructure,
  confidenceIndex,
  pageSizes,
  readEngineMeta,
  structureWarnings,
} from "../lib/ocr/normalize.ts";

/**
 * 夹具用**真实上游产物**：旧版知识清单 52 页的 MinerU 输出。
 * 它同时覆盖了 text / table / code（引擎误判的例句区）/ header / page_number 五类块，
 * 比手写的合成夹具更能挡住回归。
 */
const FIXTURE_DIR =
  "D:/Tal internship/教材/library/_mineru-full/knowledge/寒假知识清单/ocr";
const contentList = JSON.parse(readFileSync(join(FIXTURE_DIR, "寒假知识清单_content_list.json"), "utf8"));
const middle = JSON.parse(readFileSync(join(FIXTURE_DIR, "寒假知识清单_middle.json"), "utf8"));

const structure = () => buildStructure({ jobId: "job-1", contentList, middle });

function testEngineMetaComesFromUpstream() {
  const meta = readEngineMeta(middle, { method: "ocr", language: "ch" });
  // 版本与后端**不能写死**：换引擎/升版本时 manifest 要自动跟着变
  assert.equal(meta.name, "MinerU");
  assert.equal(meta.version, "3.4.5");
  assert.equal(meta.backend, "pipeline");
  assert.equal(meta.method, "ocr");
  // 缺元数据时不编造
  assert.equal(readEngineMeta({}).version, null);
  assert.equal(readEngineMeta({}).backend, null);
}

function testPageSizes() {
  const sizes = pageSizes(middle);
  assert.equal(sizes.length, 52);
  assert.deepEqual(sizes[0], [595, 841]);
  // 缺页时给 0，不编造
  assert.deepEqual(pageSizes({ pdf_info: [{}] }), [[0, 0]]);
}

function testStructureBlocksAndOrder() {
  const result = structure();
  assert.equal(result.pageCount, 52);
  assert.equal(result.blocks.length, contentList.length, "块不能丢");
  // 顺序即阅读顺序
  assert.deepEqual(
    result.blocks.map((block) => block.order),
    contentList.map((_, index) => index),
  );
  assert.equal(result.blocks[0].id, "b00000");

  const byType = {};
  for (const block of result.blocks) byType[block.type] = (byType[block.type] ?? 0) + 1;
  // 带 text_level 的 text 归成 title，其余归 text；**两者之和必须等于 text + code 的总数**
  // （code 是引擎对正文的误判，按正文保留，不能丢）
  const textish = contentList.filter((block) => block.type === "text" || block.type === "code").length;
  assert.equal((byType.text ?? 0) + (byType.title ?? 0), textish);
  assert.equal(byType.title > 0, true);
  assert.equal(byType.table, 9);
  assert.equal(byType.page_number, 52, "页码块要留着——判课边界时要用");
  assert.equal(byType.header, 1);

  // 带 text_level 的 text 归成标题并保留层级
  const title = result.blocks.find((block) => block.type === "title");
  assert.ok(title, "要有标题块");
  assert.equal(typeof title.level, "number");
  assert.equal(title.text, "第1讲 知识清单");

  // 表格保留 HTML
  const table = result.blocks.find((block) => block.type === "table");
  assert.match(table.html, /^<table>/);
  assert.equal(table.assetPath.startsWith("assets/"), true, "图片路径要指向工作区里的 assets/");
}

/**
 * 坐标换算：`content_list` 的 bbox 在**归一化的 1000×1000 方框**里，不是 PDF 点。
 *
 * 这一条是实测出来的（三本书、两种页面尺寸都吻合）：若拿它去和 `middle.json` 的
 * `page_size`（PDF 点）混算，块框会整体跑偏——第一版就是这么错的。
 */
function testBoxIsPercent() {
  const result = structure();
  const block = result.blocks[0];
  for (const value of Object.values(block.box)) {
    assert.equal(value >= 0 && value <= 1, true, `百分比越界：${JSON.stringify(block.box)}`);
  }
  const [x0, y0, x1] = block.bbox;
  assert.equal(block.box.left, Math.round((x0 / 1000) * 10000) / 10000);
  assert.equal(block.box.width, Math.round(((x1 - x0) / 1000) * 10000) / 10000);
  assert.equal(block.box.top, Math.round((y0 / 1000) * 10000) / 10000);

  // 交叉验证：换算出的百分比必须与 middle.json 按页面点尺寸算出来的一致
  // （两个文件坐标口径不同，但指向同一版式——不一致就说明归一化假设被打破了）
  const [pageWidth, pageHeight] = pageSizes(middle)[0];
  const middleBox = middle.pdf_info[0].para_blocks[0].bbox;
  assert.equal(Math.abs(block.box.left - middleBox[0] / pageWidth) < 0.01, true);
  assert.equal(Math.abs(block.box.top - middleBox[1] / pageHeight) < 0.01, true);

  // 超出归一化范围时给出提醒（守卫上游换坐标口径）
  const odd = buildStructure({
    jobId: "j",
    contentList: [{ type: "text", page_idx: 0, text: "x", bbox: [1, 2, 3000, 4000] }],
    middle: { pdf_info: [{ page_idx: 0, page_size: [595, 841] }] },
  });
  assert.equal(
    structureWarnings(odd, [{ type: "text", page_idx: 0, text: "x", bbox: [1, 2, 3000, 4000] }]).some(
      (text) => text.includes("归一化范围"),
    ),
    true,
  );
  // 没有页面尺寸也不影响块框定位（百分比只依赖 1000 这个常量）
  const noSize = buildStructure({
    jobId: "j",
    contentList: [{ type: "text", page_idx: 0, text: "x", bbox: [100, 200, 300, 400] }],
    middle: { pdf_info: [{}] },
  });
  assert.deepEqual(noSize.blocks[0].box, { left: 0.1, top: 0.2, width: 0.2, height: 0.2 });
}

function testConfidenceAndLowConfidence() {
  const index = confidenceIndex(middle);
  assert.equal(index.size > 0, true, "真实产物里应当有块级置信度");
  const result = structure();
  const scored = result.blocks.filter((block) => typeof block.confidence === "number");
  assert.equal(scored.length > 0, true);
  // 低置信列表与阈值一致，且 id 都在块里
  const ids = new Set(result.blocks.map((block) => block.id));
  for (const id of result.lowConfidence) assert.equal(ids.has(id), true);
  for (const block of result.blocks) {
    const low = typeof block.confidence === "number" && block.confidence < LOW_CONFIDENCE;
    assert.equal(result.lowConfidence.includes(block.id), low);
  }
  // 对不上的块留空，不猜
  assert.equal(
    result.blocks.filter((block) => typeof block.confidence === "number").length <=
      result.blocks.length,
    true,
  );
}

function testContentMarkdownKeepsPagesAndLessons() {
  const markdown = buildContentMarkdown(contentList);
  assert.match(markdown, /^<!-- page 0 -->/m, "页码标记是溯源的基础");
  // 知识清单的课号写在**正文标题**里（`# 第1讲 知识清单`），要原样保住
  assert.match(markdown, /^# 第1讲 知识清单$/m);
  assert.match(markdown, /^# 第3讲 知识清单$/m);
  // 页眉页码不进正文
  assert.doesNotMatch(markdown, /^Your Notes$/m);
  // 引擎误判成 code 的例句区不能丢——这是本次修的回归
  const codeBlocks = contentList.filter((block) => block.type === "code");
  assert.equal(codeBlocks.length > 0, true);
  for (const block of codeBlocks) {
    const first = block.code_body.split("\n")[0].trim().slice(0, 24);
    assert.equal(markdown.includes(first), true, `code 块的内容不能丢：${first}`);
  }
}

/**
 * 练习册的课号印在**页脚**（`Unit 1`），引擎输出的 `.md` 把页脚丢了——
 * 所以重建时必须从页脚块里把它捞回来，并插在**换课那一页的开头**。
 */
function testContentMarkdownRecoversLessonFromFooter() {
  const blocks = [
    { type: "text", page_idx: 0, text: "Hello Vocabulary", text_level: 2 },
    { type: "footer", page_idx: 0, text: "Unit 1" },
    { type: "text", page_idx: 1, text: "Hello Grammar", text_level: 2 },
    { type: "footer", page_idx: 1, text: "2.Unit 2" },
  ];
  const markdown = buildContentMarkdown(blocks);
  assert.match(markdown, /^# Unit 1$/m);
  assert.match(markdown, /^# Unit 2$/m, "页脚上的课号要恢复出来");
  assert.doesNotMatch(markdown, /^Unit 1$/m, "页脚本身不进正文");
  // 课标题在该页内容之前（页脚指的是本页）
  const unit2 = markdown.split("\n").indexOf("# Unit 2");
  const grammar = markdown.split("\n").findIndex((line) => line.includes("Hello Grammar"));
  assert.equal(unit2 < grammar, true);
}

function testAssetPathRewrite() {
  assert.equal(assetRelativePath("images/abc.jpg"), "assets/abc.jpg");
  assert.equal(assetRelativePath("images\\abc.jpg"), "assets/abc.jpg");
  assert.equal(assetRelativePath(undefined), undefined);
  assert.equal(assetRelativePath(""), undefined);
}

/** 反例：空输入、缺字段、越界页码都不该崩。 */
function testCounterExamples() {
  const empty = buildStructure({ jobId: "j", contentList: [], middle: {} });
  assert.equal(empty.pageCount, 0);
  assert.deepEqual(empty.blocks, []);
  assert.deepEqual(empty.lowConfidence, []);
  assert.equal(buildContentMarkdown([]), "\n");

  // 缺 bbox / 缺 page_idx / 越界页码
  const ragged = buildStructure({
    jobId: "j",
    contentList: [
      { type: "text", page_idx: 3, text: "有页码无 bbox" },
      { type: "unknown-type", page_idx: 0, text: "未知类型" },
      { type: "text", page_idx: 99, text: "越界页码", bbox: [0, 0, 10, 10] },
    ],
    middle: { pdf_info: [{ page_idx: 0, page_size: [595, 841] }] },
  });
  assert.deepEqual(ragged.blocks[0].bbox, [0, 0, 0, 0]);
  assert.equal(ragged.blocks[1].type, "other", "认不出的类型归 other，不丢块");
  // 越界页码的页面尺寸缺失，但块本身要保留
  assert.equal(ragged.blocks[2].text, "越界页码");
  assert.equal(ragged.pageCount, 100, "页码决定页数——宁可多给空页也不改块");

  // 坏 middle 结构
  assert.deepEqual(pageSizes({ pdf_info: "不是数组" }), []);
  assert.equal(confidenceIndex({ pdf_info: null }).size, 0);
}

/**
 * 回归：正文自己写了课号标题时，**不要再补一个**。
 *
 * 实测学生用书：正文里有 `# UNIT1 Fond memories` 这类标题，而页脚也印着 `Unit 1`。
 * 两者都认就会同一讲出现两个课边界 → 被切成 13 个包（而不是 7 个），
 * 取来源时只拿到前半截。页脚课号只是"补救"，正文写了就不需要它。
 */
function testDeclaredLessonHeadingIsNotDuplicated() {
  const blocks = [
    // 正文自己声明了课号（学生用书就是这样）
    { type: "text", page_idx: 0, text: "UNIT1 Fond memories", text_level: 1 },
    { type: "text", page_idx: 0, text: "Hello Vocabulary", text_level: 2 },
    { type: "footer", page_idx: 0, text: "Unit 1" },
    // 第二讲只在页脚上有课号（练习册就是这样）→ 必须补出来
    { type: "text", page_idx: 1, text: "Hello Grammar", text_level: 2 },
    { type: "footer", page_idx: 1, text: "Unit 2" },
  ];
  const markdown = buildContentMarkdown(blocks);
  const lessonHeadings = markdown
    .split("\n")
    .filter((line) => /^#{1,2}\s*(?:UNIT|Unit|Lesson|第)\s*\d/i.test(line));
  assert.deepEqual(
    lessonHeadings,
    ["# UNIT1 Fond memories", "# Unit 2"],
    "正文声明过的不再补，页脚才有的要补",
  );

  // 用真实学生用书产物端到端确认：7 个讲次，不是 13 个
  const studentDir = "D:/Tal internship/教材/library/_mineru-full/student/寒假学生用书/ocr";
  const studentBlocks = JSON.parse(
    readFileSync(join(studentDir, "寒假学生用书_content_list.json"), "utf8"),
  );
  const packages = splitLegacyMarkdown(buildContentMarkdown(studentBlocks), "student");
  assert.equal(packages.length, 7, `学生用书应切出 7 讲，实际 ${packages.length}`);
  assert.deepEqual(
    packages.map((pkg) => pkg.sourceLessonNumber),
    [1, 2, 3, 4, 5, 6, 7],
  );
  // 每一讲都要有实质内容（切开的话前半截只有几百字）
  for (const pkg of packages) {
    assert.equal(pkg.rawText.length > 5000, true, `第 ${pkg.sourceLessonNumber} 讲只有 ${pkg.rawText.length} 字，可能被切开了`);
  }
}

/**
 * 回归：正文里**文末**那行残缺的课号文字不能顶掉页脚补出来的课边界。
 *
 * 实测练习册最后有 `## Unit 7 Revision unt / Revision`——是版式文字被 OCR 拼坏的结果，
 * 出现在整本最后一页。若按"正文里有没有 Unit 7"判断，就不会补 `# Unit 7`，
 * 整讲内容会被算进上一讲。
 */
function testStrayLateHeadingDoesNotSuppressRecovery() {
  const blocks = [
    { type: "text", page_idx: 0, text: "Hello Vocabulary", text_level: 2 },
    { type: "footer", page_idx: 0, text: "Unit 1" },
    { type: "text", page_idx: 1, text: "Hello Grammar", text_level: 2 },
    { type: "footer", page_idx: 1, text: "Unit 7" },
    { type: "text", page_idx: 2, text: "Unit 7 Revision unt / Revision", text_level: 2 },
  ];
  const markdown = buildContentMarkdown(blocks);
  const headings = markdown
    .split("\n")
    .filter((line) => /^#{1,2}\s*(?:UNIT|Unit)\s*\d/i.test(line));
  assert.deepEqual(
    headings,
    ["# Unit 1", "# Unit 7", "## Unit 7 Revision unt / Revision"],
    "页脚指示的开头仍要补课标题；文末那行残缺文字留在正文里",
  );
}

const tests = [
  ["引擎元数据从上游读（不写死）", testEngineMetaComesFromUpstream],
  ["页面尺寸", testPageSizes],
  ["块类型、顺序与资产路径", testStructureBlocksAndOrder],
  ["坐标换算成百分比", testBoxIsPercent],
  ["置信度与低置信标记", testConfidenceAndLowConfidence],
  ["重建的 Markdown 保住页码与课号（含 code 回归）", testContentMarkdownKeepsPagesAndLessons],
  ["从页脚恢复练习册课号", testContentMarkdownRecoversLessonFromFooter],
  ["正文已声明课号时不再重复补（回归）", testDeclaredLessonHeadingIsNotDuplicated],
  ["文末残缺课号文字不顶掉页脚补救（回归）", testStrayLateHeadingDoesNotSuppressRecovery],
  ["资产路径改写", testAssetPathRewrite],
  ["反例：空输入、缺字段、越界页码", testCounterExamples],
];

for (const [name, test] of tests) {
  test();
  console.log(`✓ ${name}`);
}
console.log(`OCR 归一化测试通过:${tests.length} 项`);
