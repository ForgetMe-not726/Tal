import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorkspace } from "../lib/workspace/bootstrap.ts";
import {
  MODULE_DIRECTORY,
  ModuleDirectoryError,
  directoryKey,
  findModuleOutline,
  modulesFor,
  ordinalOf,
  resolveModuleOutline,
} from "../lib/modules/directory.ts";
import { resolveTableTemplate } from "../lib/markdown/table-templates.ts";

/** 断言某书种+课型下的模块顺序与编号。 */
function expectModules(bookType, lessonType, expected) {
  const actual = modulesFor(bookType, lessonType).map((item) =>
    item.numbered ? `${item.moduleKey}(${ordinalOf(bookType, item.moduleKey, lessonType)})` : item.moduleKey,
  );
  assert.deepEqual(actual, expected, `${bookType}/${lessonType} 的模块与编号不对`);
}

// ---------------------------------------------------------------------------
// 目录内容
// ---------------------------------------------------------------------------

function testKnowledgeModules() {
  expectModules("knowledge", "regular", [
    "learning_objectives",
    "lets_say(1)",
    "lets_read(2)",
    "lets_talk(3)",
  ]);
  // 复习课没有知识清单（需求方 2026-10-27 确认）
  expectModules("knowledge", "revision", []);
  // 学习目标是「字段名 + 内容」表，标题并进表格首行，所以 heading 为 null
  assert.equal(findModuleOutline("knowledge", "learning_objectives")?.heading, null);
}

function testStudentModules() {
  // 语法标题只写英文；Let's use 只取大纲的第一个题型，避免混用题面
  assert.match(findModuleOutline("student", "lets_talk").outline, /只写英文语法点名称/);
  assert.match(findModuleOutline("student", "lets_use").outline, /只取大纲「考试技能」列的第一个题型/);
  // 常规课 5 个模块，加不编号的主题页
  expectModules("student", "regular", [
    "learning_objectives",
    "lets_explore(1)",
    "lets_say(2)",
    "lets_read(3)",
    "lets_talk(4)",
    "lets_use(5)",
  ]);
  // 复习课没有 explore/read，编号整体前移
  expectModules("student", "revision", [
    "learning_objectives",
    "lets_say(1)",
    "lets_talk(2)",
    "lets_use(3)",
  ]);
}

/**
 * 练习册一课的板块是 `Day 1`–`Day 5`，不是 `Let's X!`。
 *
 * 依据 `26教材list-5A.xlsx` 的「练习册」审校工作表：
 * Day1–3 每天含 let's say 单词与 let's talk 语法各 1–2 题，Day4 对应 let's read，
 * Day5 对应 let's use；练习册没有 Let's explore!。
 */
function testWorkbookModules() {
  expectModules("workbook", "regular", ["day_1", "day_2", "day_3", "day_4", "day_5"]);
  expectModules("workbook", "revision", ["day_1", "day_2", "day_3", "day_4", "day_5"]);

  // 练习册的编号就是 Day 本身，不额外加「1.」前缀
  for (const day of ["day_1", "day_2", "day_3", "day_4", "day_5"]) {
    const item = findModuleOutline("workbook", day);
    assert.equal(item.numbered, false, `${day} 不该参与整课编号`);
    assert.match(item.heading, /^Day [1-5]$/);
  }

  // 旧版练习册一课只有一组「词汇 + 语法」，对应新版 Day 1–3 是扩充关系：
  // 旧内容完整放进 Day 1，Day 2/3 没有旧版来源（留给教研补充）；Day 4/5 对应 read / use。
  assert.deepEqual(findModuleOutline("workbook", "day_1").sourceSections, ["say", "talk"]);
  assert.deepEqual(findModuleOutline("workbook", "day_2").sourceSections, []);
  assert.deepEqual(findModuleOutline("workbook", "day_4").sourceSections, ["read"]);
  assert.deepEqual(findModuleOutline("workbook", "day_5").sourceSections, ["use"]);

  // 练习册没有 explore
  assert.equal(
    modulesFor("workbook", "regular").some((item) => item.moduleKey.includes("explore")),
    false,
    "练习册不该有 Let's explore! 板块",
  );
}

/**
 * 同一个 module_key 在两个书种里必须是不同的东西。
 * 早先按 module_key 单独索引骨架，导致学生用书查不到而静默回退——
 * 这条断言是那类回归的守卫。
 */
function testSameKeyDiffersByBook() {
  const knowledge = findModuleOutline("knowledge", "lets_say");
  const student = findModuleOutline("student", "lets_say");
  assert.ok(knowledge && student, "两个书种都要有 lets_say");
  assert.notEqual(knowledge.outline, student.outline);
  assert.notEqual(knowledge.displayName, student.displayName);
  // 知识清单是中文词卡表，学生用书是英文短文 + word box
  assert.match(knowledge.outline, /词卡|难度.*词汇/s);
  assert.match(student.outline, /短文|word box/);

  // 阅读模块同理：知识清单是词汇+技能分析，学生用书是文章+题目
  assert.notEqual(
    findModuleOutline("knowledge", "lets_read").outline,
    findModuleOutline("student", "lets_read").outline,
  );
}

function testEveryModuleHasOutline() {
  for (const item of MODULE_DIRECTORY) {
    assert.ok(item.outline.trim().length > 0, `${directoryKey(item.bookType, item.moduleKey)} 缺骨架`);
    assert.ok(item.displayName.trim().length > 0, `${item.moduleKey} 缺显示名`);
  }
  // 未知模块不返回骨架——由调用方抛错，不静默回退
  assert.equal(findModuleOutline("student", "does_not_exist"), null);
}

/**
 * 复习课的**题源栏目**也与常规课不同。
 *
 * 旧版练习册的复习单元是整课复习，没有 `Hello X` 栏目名，内容统一归 `revision`；
 * 常规课的任何模块都不取这个键（day_1 取 say+talk、day_4 取 read、day_5 取 use），
 * 所以它不会混进常规课的正文。复习课的 Day 1（词汇+语法）与 Day 5（写作）才取它。
 */
function testRevisionSourceSections() {
  const row = (moduleKey) => ({
    book_type: "workbook",
    module_key: moduleKey,
    display_name: "",
    sort_order: 0,
    description: "",
    payload: {},
  });

  assert.deepEqual(resolveModuleOutline(row("day_1"), "revision").sourceSections, ["revision"]);
  assert.deepEqual(resolveModuleOutline(row("day_5"), "revision").sourceSections, ["revision"]);
  // 常规课的题源不受影响
  assert.deepEqual(resolveModuleOutline(row("day_1"), "regular").sourceSections, ["say", "talk"]);
  assert.deepEqual(resolveModuleOutline(row("day_5"), "regular").sourceSections, ["use"]);
  // 没写复习课题源的模块沿用常规课的（Day 2/3 本来就没有旧版对应内容）
  assert.deepEqual(resolveModuleOutline(row("day_2"), "revision").sourceSections, []);
  assert.deepEqual(resolveModuleOutline(row("day_4"), "revision").sourceSections, ["read"]);

  // 常规课的模块都不取 revision——这是「复习材料不会混进常规课」的守卫
  for (const moduleKey of ["day_1", "day_2", "day_3", "day_4", "day_5"]) {
    assert.equal(
      resolveModuleOutline(row(moduleKey), "regular").sourceSections.includes("revision"),
      false,
      `${moduleKey} 的常规课题源不该包含 revision`,
    );
  }

  // payload 可以覆盖（教研不改代码也能调）
  assert.deepEqual(
    resolveModuleOutline(
      { ...row("day_1"), payload: { revisionSourceSections: ["revision", "notes"] } },
      "revision",
    ).sourceSections,
    ["revision", "notes"],
  );
}

/**
 * 复习课的小节结构与常规课不同，骨架必须按课型分开给。
 *
 * 学生用书复习课只有 say/talk/use，小节从 `1a` 起，内容是把旧版整课复习材料当题源
 * 重排（R-SB-019）。拿常规课的骨架去生成复习课，会产出 2a/4a/5a 这种错编号。
 */
function testRevisionOutlineResolvesByLessonType() {
  const row = (moduleKey) => ({
    book_type: "student",
    module_key: moduleKey,
    display_name: "",
    sort_order: 0,
    description: "",
    payload: {},
  });

  for (const moduleKey of ["lets_say", "lets_talk", "lets_use"]) {
    const regular = resolveModuleOutline(row(moduleKey), "regular");
    const revision = resolveModuleOutline(row(moduleKey), "revision");
    assert.notEqual(revision.outline, regular.outline, `${moduleKey} 的复习课骨架必须另给`);
    assert.match(revision.outline, /复习课/, `${moduleKey} 复习课骨架要说清是复习课`);
    assert.match(revision.outline, /只作题源/, `${moduleKey} 复习课骨架要限定旧版材料的用法`);
    // 常规课骨架不受影响
    assert.equal(regular.outline, findModuleOutline("student", moduleKey).outline);
  }

  // 没写 revisionOutline 的模块（知识清单、练习册）沿用常规课骨架
  const knowledgeRow = { ...row("lets_say"), book_type: "knowledge" };
  assert.equal(
    resolveModuleOutline(knowledgeRow, "revision").outline,
    resolveModuleOutline(knowledgeRow, "regular").outline,
  );

  // payload 可以覆盖复习课骨架（教研不改代码也能调）
  const overridden = resolveModuleOutline(
    { ...row("lets_say"), payload: { revisionOutline: "自定义复习课骨架" } },
    "revision",
  );
  assert.equal(overridden.outline, "自定义复习课骨架");
  // 覆盖复习课骨架不影响常规课
  assert.match(resolveModuleOutline({ ...row("lets_say"), payload: { revisionOutline: "x" } }, "regular").outline, /短文/);
}

// ---------------------------------------------------------------------------
// 表格模板按书种区分
// ---------------------------------------------------------------------------

function testTableTemplateIsBookScoped() {
  const sayHeader = ["名词", "动词", "形容词", "副词"];
  // 知识清单的 lets_say 里这张表是派生词表，有专门的居中和列宽
  assert.equal(resolveTableTemplate({ bookType: "knowledge", moduleKey: "lets_say" }, sayHeader), "derived");
  // 学生用书的 lets_say 是 2b word box，落到通用的等宽表格
  assert.equal(resolveTableTemplate({ bookType: "student", moduleKey: "lets_say" }, sayHeader), "generic");

  // 词卡按表头形状判定，与书种无关
  const cardHeader = ["难度", "词汇", "音标", "词性和含义"];
  assert.equal(resolveTableTemplate({ bookType: "student", moduleKey: "lets_say" }, cardHeader), "word-card");

  // 空表头**只**在学习目标模块算数：旧版网格题转成 Markdown 后也是空表头，
  // 认成学习目标表会把首行换成模块标题、第一列压成 92px 蓝色。
  assert.equal(resolveTableTemplate({ bookType: "knowledge", moduleKey: "learning_objectives" }, ["", ""]), "objectives");
  assert.equal(resolveTableTemplate({ bookType: "workbook", moduleKey: "day_1" }, ["", "", "", ""]), "generic");
  assert.equal(resolveTableTemplate({ bookType: "workbook", moduleKey: "day_1" }, ["", ""]), "generic");
}

// ---------------------------------------------------------------------------
// 与工作区目录文件的一致性守卫
// ---------------------------------------------------------------------------

/**
 * 首次运行时写进工作区的目录文件，必须与出厂目录逐项一致。
 *
 * 这里跑的是真实代码路径（`ensureWorkspace`），不是读一份静态文件——
 * 原先的守卫读 `supabase/seed.sql`，那份 SQL 已随数据库一并删除。
 */
async function testWorkspaceSeedMatchesDirectory() {
  const root = mkdtempSync(join(tmpdir(), "module-dir-"));
  process.env.AI_TEACHING_WORKSPACE = root;
  try {
    await ensureWorkspace();
    const seeded = JSON.parse(readFileSync(join(root, "module-definitions.json"), "utf8"));

    assert.equal(seeded.length, MODULE_DIRECTORY.length);
    const actual = seeded
      .map((row) => `${row.book_type}:${row.module_key}:${row.sort_order}`)
      .sort();
    const expected = MODULE_DIRECTORY
      .map((item) => `${item.bookType}:${item.moduleKey}:${item.sortOrder}`)
      .sort();
    assert.deepEqual(actual, expected, "工作区目录文件与 MODULE_DIRECTORY 不一致");

    // 骨架等字段也要带上，否则运行时解析不出模块定义
    const letsSay = seeded.find((row) => row.book_type === "student" && row.module_key === "lets_say");
    assert.equal(letsSay.payload.numbered, true);
    assert.deepEqual(letsSay.payload.sourceSections, ["say"]);
    assert.equal(letsSay.payload.heading, "Let's say!");
  } finally {
    delete process.env.AI_TEACHING_WORKSPACE;
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 目录项解析：数据库可覆盖，缺骨架必须报错
// ---------------------------------------------------------------------------

function directoryRow(bookType, moduleKey, payload = {}) {
  return {
    id: "x",
    book_type: bookType,
    module_key: moduleKey,
    display_name: moduleKey,
    sort_order: 0,
    description: "",
    payload,
    created_at: "",
    updated_at: "",
  };
}

function testResolveFallsBackToFactoryDefault() {
  const student = resolveModuleOutline(directoryRow("student", "lets_say"));
  const knowledge = resolveModuleOutline(directoryRow("knowledge", "lets_say"));
  assert.equal(student.outline, findModuleOutline("student", "lets_say").outline);
  assert.equal(knowledge.outline, findModuleOutline("knowledge", "lets_say").outline);
  assert.notEqual(student.outline, knowledge.outline);
}

function testDatabaseOverridesFactoryDefault() {
  const resolved = resolveModuleOutline(
    directoryRow("knowledge", "lets_say", {
      outline: "数据库里的自定义骨架",
      heading: "自定义标题",
      numbered: false,
      sourceSections: ["say", "revision", "不存在的键"],
    }),
  );
  assert.equal(resolved.outline, "数据库里的自定义骨架");
  assert.equal(resolved.heading, "自定义标题");
  assert.equal(resolved.numbered, false);
  // 认不出的栏目键被丢掉，不静默带进检索
  assert.deepEqual(resolved.sourceSections, ["say", "revision"]);
}

/**
 * 没有骨架时必须抛错。
 *
 * 早先这里会静默回退成“按知识清单的常规结构输出该模块的完整正文”，
 * 学生用书 5 个模块全部命中，产出结构不受控的稿子且没有任何提示。
 */
function testMissingOutlineThrows() {
  assert.throws(
    () => resolveModuleOutline(directoryRow("workbook", "brand_new_module")),
    ModuleDirectoryError,
  );
  // 非法枚举值也不能悄悄放过
  assert.throws(
    () => resolveModuleOutline(directoryRow("knowledge", "lets_talk", { deterministic: "nope" })),
    ModuleDirectoryError,
  );
}

function testHeadingNullIsRespected() {
  // 知识清单「学习目标」的标题要并进表格首行，所以 heading 显式为 null 不能被 ?? 吞掉
  assert.equal(findModuleOutline("knowledge", "learning_objectives").heading, null);
  assert.equal(
    resolveModuleOutline(directoryRow("knowledge", "lets_say", { heading: null })).heading,
    null,
  );
}

/** 复习课没有知识清单：目录取数层要挡住，即使工作区里的 payload 还写着两课型。 */
async function testKnowledgeHasNoRevision() {
  const root = mkdtempSync(join(tmpdir(), "module-dir-"));
  process.env.AI_TEACHING_WORKSPACE = root;
  try {
    await ensureWorkspace();
    // 模拟老工作区：payload 明确写着知识清单也支持复习课
    const file = join(root, "module-definitions.json");
    const rows = JSON.parse(readFileSync(file, "utf8")).map((row) =>
      row.book_type === "knowledge"
        ? { ...row, payload: { ...row.payload, lessonTypes: ["regular", "revision"] } }
        : row,
    );
    writeFileSync(file, JSON.stringify(rows));
    const { listModuleDefinitions } = await import("../lib/modules/service.ts");
    assert.deepEqual(await listModuleDefinitions("knowledge", "revision"), [], "复习课不产出知识清单");
    assert.equal((await listModuleDefinitions("knowledge", "regular")).length, 4, "常规课四个模块不变");
    assert.ok((await listModuleDefinitions("student", "revision")).length > 0, "学生用书复习课照常");
  } finally {
    delete process.env.AI_TEACHING_WORKSPACE;
    rmSync(root, { recursive: true, force: true });
  }
}

const tests = [
  ["知识清单模块与编号", testKnowledgeModules],
  ["学生用书模块与编号（含复习课）", testStudentModules],
  ["练习册 Day 1-5 模块", testWorkbookModules],
  ["同一 module_key 按书种区分", testSameKeyDiffersByBook],
  ["每个模块都有骨架", testEveryModuleHasOutline],
  ["复习课骨架按课型解析", testRevisionOutlineResolvesByLessonType],
  ["复习课题源按课型解析", testRevisionSourceSections],
  ["表格模板按书种区分", testTableTemplateIsBookScoped],
  ["目录项缺骨架时报错（不静默回退）", testMissingOutlineThrows],
  ["数据库覆盖出厂默认", testDatabaseOverridesFactoryDefault],
  ["目录项回落到出厂默认", testResolveFallsBackToFactoryDefault],
  ["heading 显式 null 被尊重", testHeadingNullIsRespected],
  ["工作区目录文件与出厂目录一致", testWorkspaceSeedMatchesDirectory],
  ["复习课没有知识清单", testKnowledgeHasNoRevision],
];

for (const [name, test] of tests) {
  // 有的用例要落盘（工作区初始化），统一 await 以支持异步。
  await test();
  console.log(`✓ ${name}`);
}
console.log(`模块目录测试通过:${tests.length} 项`);
