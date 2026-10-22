import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, FileStoreError } from "../lib/db/file-store.ts";
import { loadRelatedVersions } from "../lib/knowledge/related-content.ts";
import { workspaceProject } from "../lib/workspace/default-project.ts";
import { ensureWorkspace } from "../lib/workspace/bootstrap.ts";
import { readJson, writeJson } from "../lib/workspace/json.ts";

/** 每个用例一个干净工作区，互不干扰。 */
function withWorkspace(run) {
  const root = mkdtempSync(join(tmpdir(), "file-store-"));
  process.env.AI_TEACHING_WORKSPACE = root;
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => {
      delete process.env.AI_TEACHING_WORKSPACE;
      rmSync(root, { recursive: true, force: true });
    });
}

const store = () => new FileStore();

// ---------------------------------------------------------------------------
// 工作区初始化
// ---------------------------------------------------------------------------

async function testBootstrapCreatesTree() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    for (const dir of ["rules", "knowledge", "projects", "exports", ".app"]) {
      assert.ok(existsSync(join(root, dir)), `缺少目录 ${dir}`);
    }
    assert.ok(existsSync(join(root, "workspace.json")));
    assert.ok(existsSync(join(root, "module-definitions.json")));
    // 可重建区域不能是事实源，但目录要建好
    for (const dir of ["jobs", "logs"]) {
      assert.ok(existsSync(join(root, ".app", dir)));
    }
  });
}

/** 初始化必须幂等，且不能覆盖老师已经改过的内容。 */
async function testBootstrapIsIdempotentAndNonDestructive() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const path = join(root, "module-definitions.json");
    const seeded = JSON.parse(readFileSync(path, "utf8"));
    // 模拟老师改过：删掉一条
    await writeJson(path, seeded.slice(0, 2));
    await ensureWorkspace();
    assert.equal(JSON.parse(readFileSync(path, "utf8")).length, 2, "重新初始化不能覆盖老师的内容");
  });
}

/** 结构版本不匹配要报错，不能悄悄按新结构用旧工作区。 */
async function testSchemaVersionMismatchThrows() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const path = join(root, "workspace.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    await writeJson(path, { ...file, schema_version: 999 });
    await assert.rejects(() => ensureWorkspace(), /结构版本不匹配/);
  });
}

// ---------------------------------------------------------------------------
// 规则（工作区级，跨项目）
// ---------------------------------------------------------------------------

async function testRuleCrudRoundTrip() {
  await withWorkspace(async () => {
    const s = store();
    // 新工作区自带随包基线规则（审校标准迁来的那批），所以这里数的是**增量**，
    // 不是绝对值——否则每次往基线加规则都要改这个测试。
    const baseline = (await s.listRules()).length;
    const rule = await s.insertRule({
      rule_key: "R-KL-003",
      display_name: "核心词汇来源保真",
      rule_type: "generation",
      is_hard: true,
      description: "知识清单规则",
    });
    assert.ok(rule.id);

    const version = await s.insertRuleVersion({
      rule_id: rule.id,
      version_number: 1,
      instruction: "词头、词性与释义须与确认来源一致。",
      constraints: { require_confirmed_source: true },
      status: "published",
      created_by: "test",
      change_note: "初版",
      published_at: "2026-09-22T00:00:00.000Z",
    });
    assert.equal(version.version_number, 1);

    const binding = await s.insertRuleBinding({
      rule_id: rule.id,
      scope: "book",
      project_id: null,
      grade: null,
      book_type: "knowledge",
      module_key: null,
      lesson_id: null,
    });
    assert.equal(binding.scope, "book");

    assert.equal((await s.listRules()).length, baseline + 1);
    assert.equal((await s.listRuleVersions({ ruleId: rule.id })).length, 1);
    assert.equal((await s.getLatestRuleVersion(rule.id)).version_number, 1);
    assert.equal((await s.listRuleBindings(rule.id)).length, 1);

    const updated = await s.updateRule(rule.id, { display_name: "改过的名字" });
    assert.equal(updated.display_name, "改过的名字");

    const deprecated = await s.updateRuleVersion(rule.id, version.id, { status: "deprecated" });
    assert.equal(deprecated.status, "deprecated");

    assert.equal(await s.deleteRuleBinding(rule.id, binding.id), true);
    assert.equal((await s.listRuleBindings(rule.id)).length, 0);
    assert.equal(await s.deleteRule(rule.id), true);
    assert.equal((await s.listRules()).length, baseline, "删掉自己加的那条，基线原样还在");
  });
}

async function testDuplicateRuleKeyRejected() {
  await withWorkspace(async () => {
    const s = store();
    const input = {
      rule_key: "R-KL-001",
      display_name: "A",
      rule_type: "generation",
      is_hard: false,
      description: "",
    };
    await s.insertRule(input);
    await assert.rejects(() => s.insertRule(input), FileStoreError);
  });
}

// ---------------------------------------------------------------------------
// 项目 → 课时 → 书 → 模块 → 版本
// ---------------------------------------------------------------------------

async function testFullHierarchyRoundTrip() {
  await withWorkspace(async (root) => {
    const s = store();
    const project = await s.insertProject({ name: "冬季教材迁移", grade: "L5", term: "winter" });
    const lesson = await s.insertLesson({
      project_id: project.id,
      lesson_number: 1,
      title: "Fond memories",
    });
    assert.equal(lesson.lesson_type, "regular");
    assert.equal(lesson.status, "not_started");

    const book = await s.insertBook({ lesson_id: lesson.id, book_type: "student" });
    const moduleRow = await s.insertModule({
      book_id: book.id,
      module_key: "lets_say",
      display_name: "Let's say!",
      sort_order: 2,
    });
    const version = await s.insertModuleVersion({
      module_id: moduleRow.id,
      version_number: 1,
      content: { markdown: "## Let's say!\n\n正文" },
      content_format: "markdown",
      origin_kind: "ai_generated",
      origin_summary: { copy: 0, adapt: 1, generate: 0 },
      created_by: "system",
    });

    // 按自然键与按 ID 都要能查回来
    assert.equal((await s.getProjectByNaturalKey("冬季教材迁移", "L5", "winter")).id, project.id);
    assert.equal((await s.getLessonByNaturalKey(project.id, 1)).id, lesson.id);
    assert.equal((await s.getLessonById(lesson.id)).id, lesson.id);
    assert.equal((await s.getBook(lesson.id, "student")).id, book.id);
    assert.equal((await s.getModule(book.id, "lets_say")).id, moduleRow.id);
    assert.equal((await s.getModuleVersion(version.id)).id, version.id);
    assert.equal((await s.listBooksByLesson(lesson.id)).length, 1);
    assert.equal((await s.listModulesByBookIds([book.id])).length, 1);
    assert.equal((await s.listModuleVersions({ moduleId: moduleRow.id })).length, 1);

    // 文件确实落在 profile 的目录契约上，而不是藏在某个索引里
    const moduleFile = join(root, "projects", project.id, "lessons", "lesson-01", "books", "student", "lets_say", "module.json");
    assert.ok(existsSync(moduleFile), `模块元数据应落在 ${moduleFile}`);
    assert.ok(
      existsSync(join(root, "projects", project.id, "lessons", "lesson-01", "books", "student", "lets_say", "versions", "1.json")),
    );

    await s.updateModuleStatus(moduleRow.id, "confirmed");
    assert.equal((await s.getModule(book.id, "lets_say")).status, "confirmed");
    await s.updateLesson(lesson.id, { title: "改过标题", lesson_type: "revision" });
    const reread = await s.getLessonById(lesson.id);
    assert.equal(reread.title, "改过标题");
    assert.equal(reread.lesson_type, "revision");
  });
}

/** 版本号必须能取到最新，用于"AI 重生成产生新版本"。 */
async function testModuleVersionsOrderedDesc() {
  await withWorkspace(async () => {
    const s = store();
    const project = await s.insertProject({ name: "P", grade: "L5", term: "winter" });
    const lesson = await s.insertLesson({ project_id: project.id, lesson_number: 1, title: "L1" });
    const book = await s.insertBook({ lesson_id: lesson.id, book_type: "knowledge" });
    const moduleRow = await s.insertModule({ book_id: book.id, module_key: "lets_read", display_name: "R", sort_order: 1 });
    for (const n of [1, 2, 3]) {
      await s.insertModuleVersion({
        module_id: moduleRow.id,
        version_number: n,
        content: { markdown: `v${n}` },
        content_format: "markdown",
        origin_kind: "ai_generated",
        origin_summary: { copy: 0, adapt: 0, generate: 1 },
        created_by: "system",
      });
    }
    const versions = await s.listModuleVersions({ moduleId: moduleRow.id });
    assert.deepEqual(versions.map((v) => v.version_number), [3, 2, 1]);
  });
}

// ---------------------------------------------------------------------------
// 来源 / 映射 / 知识条目
// ---------------------------------------------------------------------------

async function testSourcesAndKnowledgeEntries() {
  await withWorkspace(async () => {
    const s = store();
    const project = await s.insertProject({ name: "P", grade: "L5", term: "winter" });
    const lesson = await s.insertLesson({ project_id: project.id, lesson_number: 2, title: "L2" });

    const source = await s.insertSourceModule({
      project_id: project.id,
      lesson_id: lesson.id,
      book_type: "student",
      title: "UNIT2 Hello Reading",
      sort_order: 0,
      status: "confirmed",
      source_document: "寒假学生用书.pdf",
      page: 42,
      notes: "",
      payload: { section: "read" },
    });
    assert.equal((await s.getSourceModule(source.id)).title, "UNIT2 Hello Reading");
    assert.equal((await s.listSourceModules({ lessonId: lesson.id })).length, 1);
    assert.equal((await s.listSourceModules({ status: "pending" })).length, 0);

    await s.insertModuleMapping({
      project_id: project.id,
      source_module_id: source.id,
      target_module_id: "module-def-006",
      mapping_type: "one_to_one",
      priority: 0,
      notes: "",
      payload: {},
    });
    assert.equal((await s.listModuleMappings({ projectId: project.id })).length, 1);
    assert.equal((await s.listModuleMappings({ sourceModuleIds: [source.id] })).length, 1);
    assert.equal((await s.listModuleMappings({ sourceModuleIds: [] })).length, 1, "空数组不过滤");

    // 课时级生产来源
    const entry = await s.insertKnowledgeEntry({
      layer: "production_source",
      entry_type: "module_text",
      title: "L2 · 阅读",
      content: "课文正文",
      payload: { source_status: "confirmed" },
      project_id: project.id,
      grade: "L5",
      lesson_id: lesson.id,
      book_type: "student",
      module_key: "lets_read",
      source_module_id: source.id,
      source_ref: "legacy-sb:lesson-2:read",
    });
    assert.equal((await s.getKnowledgeEntryBySourceRef("legacy-sb:lesson-2:read")).id, entry.id);
    assert.equal((await s.listKnowledgeEntries({ confirmedOnly: true })).length, 1);

    // 工作区级参考资料（不属于任何课时）
    await s.insertKnowledgeEntry({
      layer: "reference_materials",
      entry_type: "wordlist",
      title: "Cambridge B2 词表",
      content: "…",
      payload: { source_status: "confirmed" },
      project_id: null,
      grade: null,
      lesson_id: null,
      book_type: null,
      module_key: null,
      source_module_id: null,
      source_ref: "cambridge:b2:wordlist",
    });
    const all = await s.listKnowledgeEntries({});
    assert.equal(all.length, 2);
    assert.equal((await s.listKnowledgeEntries({ layers: ["reference_materials"] })).length, 1);
    assert.equal((await s.listKnowledgeEntries({ lessonId: lesson.id })).length, 1, "参考资料不挂在课时上");

    await s.updateSourceModule(source.id, { status: "pending" });
    assert.equal((await s.getSourceModule(source.id)).status, "pending");
    await s.updateKnowledgeEntry(entry.id, { content: "改过的正文" });
    assert.equal((await s.getKnowledgeEntryBySourceRef("legacy-sb:lesson-2:read")).content, "改过的正文");
  });
}

/**
 * 未确认的 OCR 不能进正式生成。
 *
 * 这是 profile 的硬约束：production_source 必须显式 confirmed，
 * 其他分层排除 pending 即可。
 */
async function testConfirmedOnlyFilter() {
  await withWorkspace(async () => {
    const s = store();
    const base = {
      entry_type: "module_text",
      title: "t",
      content: "c",
      project_id: null,
      grade: null,
      lesson_id: null,
      book_type: null,
      module_key: null,
      source_module_id: null,
    };
    await s.insertKnowledgeEntry({
      ...base, layer: "production_source", payload: { source_status: "pending" }, source_ref: "a",
    });
    await s.insertKnowledgeEntry({
      ...base, layer: "production_source", payload: { source_status: "confirmed" }, source_ref: "b",
    });
    await s.insertKnowledgeEntry({
      ...base, layer: "reference_materials", payload: { source_status: "pending" }, source_ref: "c",
    });
    await s.insertKnowledgeEntry({
      ...base, layer: "reference_materials", payload: { source_status: "confirmed" }, source_ref: "d",
    });
    const confirmed = await s.listKnowledgeEntries({ confirmedOnly: true });
    assert.deepEqual(confirmed.map((row) => row.source_ref).sort(), ["b", "d"]);
  });
}

// ---------------------------------------------------------------------------
// 持久化与健壮性
// ---------------------------------------------------------------------------

/** 这是 mock 模式最大的痛点：进程重启后数据还在。 */
async function testSurvivesNewStoreInstance() {
  await withWorkspace(async () => {
    const first = store();
    const project = await first.insertProject({ name: "持久化", grade: "L5", term: "winter" });
    await first.insertLesson({ project_id: project.id, lesson_number: 1, title: "L1" });

    // 模拟进程重启：换一个全新的 store 实例（模块级单例也清掉）
    const second = store();
    const projects = await second.getProjectByNaturalKey("持久化", "L5", "winter");
    assert.ok(projects, "重启后项目必须还在");
    assert.equal((await second.getLessonByNaturalKey(projects.id, 1)).title, "L1");
  });
}

/** 损坏的 JSON 要明确报错，不能静默当成空数据——那等于悄悄丢事实。 */
async function testCorruptedJsonThrows() {
  await withWorkspace(async (root) => {
    await ensureWorkspace();
    const path = join(root, "module-definitions.json");
    writeFileSync(path, "{ 这不是 JSON", "utf8");
    await assert.rejects(() => readJson(path, []), /损坏/);
    await assert.rejects(() => store().listModuleDefinitions(), /损坏/);
  });
}

/** 并发写同一个文件不能丢数据（按路径加锁 + 原子写）。 */
async function testConcurrentWritesDoNotLoseData() {
  await withWorkspace(async (root) => {
    const path = join(root, "concurrent.json");
    await writeJson(path, { hits: 0 });
    await Promise.all(
      Array.from({ length: 25 }, () =>
        import("../lib/workspace/json.ts").then(({ updateJson }) =>
          updateJson(path, { hits: 0 }, (current) => ({ hits: current.hits + 1 })),
        ),
      ),
    );
    assert.equal(JSON.parse(readFileSync(path, "utf8")).hits, 25);
  });
}

/** 目录名安全化：带路径分隔符的标识不能写到工作区外面。 */
async function testUnsafeSegmentsAreSanitized() {
  await withWorkspace(async (root) => {
    const s = store();
    const { readdirSync } = await import("node:fs");
    await ensureWorkspace();
    // rules/ 里已经有随包基线，所以看的是**新增**了哪个目录，不是目录总数
    const before = new Set(readdirSync(join(root, "rules")));
    const rulesBefore = (await s.listRules()).length;
    const rule = await s.insertRule({
      rule_key: "../escape",
      display_name: "x",
      rule_type: "generation",
      is_hard: false,
      description: "",
    });
    assert.equal((await s.listRules()).length, rulesBefore + 1);
    // 目录必须仍在 rules/ 下面
    const added = readdirSync(join(root, "rules")).filter((name) => !before.has(name));
    assert.equal(added.length, 1, "只多出自己插的这一个");
    assert.ok(!added[0].includes(".."), "标识里的 .. 必须被清掉");
    assert.ok(!/[/\\]/u.test(added[0]), "标识里的路径分隔符必须被清掉");
    assert.equal(
      (await s.listRules()).some((item) => item.id === rule.id),
      true,
    );
  });
}

/**
 * 跨书上下文加载器（生成与修改建议共用）。
 *
 * 关键不变量：**草稿不能当上下文依据**——只取已确认模块，且必须排除正在改的那一个。
 * 这条守不住的话，AI 会拿自己没被确认过的草稿去"参考"，错上加错。
 */
async function testRelatedContentLoader() {
  await withWorkspace(async () => {
    const s = store();
    const project = await s.insertProject({ name: "P", grade: "L5", term: "winter" });
    const lesson = await s.insertLesson({ project_id: project.id, lesson_number: 1, title: "L1" });
    const student = await s.insertBook({ lesson_id: lesson.id, book_type: "student" });
    const workbook = await s.insertBook({ lesson_id: lesson.id, book_type: "workbook" });

    const version = (moduleId, markdown) =>
      s.insertModuleVersion({
        module_id: moduleId,
        version_number: 1,
        content: { markdown },
        content_format: "markdown",
        origin_kind: "ai_generated",
        origin_summary: { copy: 0, adapt: 0, generate: 1 },
        created_by: "system",
      });

    const self = await s.insertModule({ book_id: student.id, module_key: "lets_say", display_name: "Say", sort_order: 1 });
    await version(self.id, "自己的正文");
    const confirmed = await s.insertModule({ book_id: workbook.id, module_key: "day_1", display_name: "Day 1", sort_order: 1 });
    await version(confirmed.id, "练习册正文");
    await s.updateModuleStatus(confirmed.id, "confirmed");
    const draft = await s.insertModule({ book_id: workbook.id, module_key: "day_2", display_name: "Day 2", sort_order: 2 });
    await version(draft.id, "草稿正文");

    const result = await loadRelatedVersions({ lessonId: lesson.id, excludeModuleId: self.id });
    assert.deepEqual(result.versions.map((item) => item.moduleKey), ["day_1"], "只取已确认模块，并排除自己");
    assert.equal(result.versions[0].markdown, "练习册正文");
    assert.equal(result.versions[0].bookType, "workbook");
    assert.equal(result.omitted, 0);

    // 自己也没被确认时，仍然不能出现在"其他内容"里
    await s.updateModuleStatus(self.id, "confirmed");
    const stillExcluded = await loadRelatedVersions({ lessonId: lesson.id, excludeModuleId: self.id });
    assert.deepEqual(stillExcluded.versions.map((item) => item.moduleKey), ["day_1"]);

    // 预算：超了就少带，并如实报告少带了几个
    const budgeted = await loadRelatedVersions({ lessonId: lesson.id, excludeModuleId: self.id, maxChars: 1 });
    assert.equal(budgeted.versions.length, 0);
    assert.equal(budgeted.omitted, 1);

    // 只留某些书种
    const studentOnly = await loadRelatedVersions({
      lessonId: lesson.id,
      excludeModuleId: self.id,
      bookTypes: ["student"],
    });
    assert.deepEqual(studentOnly.versions, [], "学生用书里只有自己，排除后为空");
  });
}

/**
 * 工作区默认项目：老师不需要选项目。
 *
 * 空工作区自动建一个；**已有历史项目就沿用它**。学期是隔离维度：
 * 不同学期的 Lesson 编号都从 1 开始，挤在一个项目里会互相覆盖。
 */
async function testWorkspaceProjectIsImplicit() {
  // 1) 空工作区：按学期建；同学期再取是同一个
  await withWorkspace(async () => {
    const spring = await workspaceProject({ term: "spring", grade: "L5" });
    assert.equal(spring.term, "spring");
    assert.match(spring.name, /春季/u);
    assert.equal((await workspaceProject({ term: "spring", grade: "L5" })).id, spring.id);

    // 2) 不同学期是不同项目
    const winter = await workspaceProject({ term: "winter", grade: "L5" });
    assert.notEqual(winter.id, spring.id);
    assert.equal(winter.term, "winter");

    // 3) 不给条件：取最早创建的那个（识别侧用这条）
    assert.equal((await workspaceProject()).id, spring.id);
    assert.equal((await store().listProjects()).length, 2);
  });

  // 4) 已有历史项目：沿用它，不新建
  await withWorkspace(async () => {
    const s = store();
    const historical = await s.insertProject({ name: "冬季教材迁移", grade: "L5", term: "winter" });
    assert.equal((await workspaceProject({ term: "winter", grade: "L5" })).id, historical.id);
    assert.equal((await s.listProjects()).length, 1, "不能另起一个项目");
  });
}

const tests = [
  ["工作区初始化建出完整目录树", testBootstrapCreatesTree],
  ["初始化幂等且不覆盖老师内容", testBootstrapIsIdempotentAndNonDestructive],
  ["结构版本不匹配时拒绝启动", testSchemaVersionMismatchThrows],
  ["规则 CRUD 往返（工作区级）", testRuleCrudRoundTrip],
  ["重复规则标识被拒绝", testDuplicateRuleKeyRejected],
  ["项目→课时→书→模块→版本往返", testFullHierarchyRoundTrip],
  ["模块版本按版本号倒序", testModuleVersionsOrderedDesc],
  ["来源 / 映射 / 知识条目", testSourcesAndKnowledgeEntries],
  ["未确认条目被 confirmedOnly 挡住", testConfirmedOnlyFilter],
  ["重启后数据仍在（原 mock 痛点）", testSurvivesNewStoreInstance],
  ["损坏的 JSON 明确报错", testCorruptedJsonThrows],
  ["并发写不丢数据", testConcurrentWritesDoNotLoseData],
  ["危险目录名被安全化", testUnsafeSegmentsAreSanitized],
  ["跨书上下文只取已确认且排除自己", testRelatedContentLoader],
  ["默认项目隐式存在且沿用历史项目", testWorkspaceProjectIsImplicit],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}
console.log(`本地文件工作区测试通过:${tests.length} 项`);
