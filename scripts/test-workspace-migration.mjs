import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateWorkspaceLayout } from "../lib/workspace/migrate.ts";

function temp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 造一个旧工作区：workspace.json、项目、资料库、2026-10-23 布局的 sources/ocr。 */
function legacyWorkspace(root) {
  mkdirSync(join(root, "projects", "p-1"), { recursive: true });
  writeFileSync(join(root, "workspace.json"), JSON.stringify({ schema_version: 1 }));
  writeFileSync(join(root, "projects", "p-1", "project.json"), JSON.stringify({ id: "p-1" }));
  mkdirSync(join(root, "knowledge", "collections", "autumn-2026-l5"), { recursive: true });
  writeFileSync(join(root, "knowledge", "collections", "autumn-2026-l5", "manifest.json"), "{}");
  mkdirSync(join(root, "sources", "ocr", "spring-sb-ocr", "pages"), { recursive: true });
  writeFileSync(join(root, "sources", "ocr", "spring-sb-ocr", "manifest.json"), "{}");
  writeFileSync(join(root, "sources", "ocr", "spring-sb-ocr", "pages", "p0001.jpg"), "x");
}

// 1) 旧目录整体搬到 <安装目录>/document，旧目录删除，sources/ocr 归位到 ocr/
{
  const install = temp("install-");
  const legacy = temp("legacy-");
  try {
    legacyWorkspace(legacy);
    const root = join(install, "document");
    const result = await migrateWorkspaceLayout({ root, legacyRoot: legacy, installRoot: install });
    assert.equal(result, "migrated");
    assert.equal(existsSync(join(root, "workspace.json")), true);
    assert.equal(existsSync(join(root, "projects", "p-1", "project.json")), true);
    assert.equal(
      existsSync(join(root, "knowledge", "collections", "autumn-2026-l5", "manifest.json")),
      true,
    );
    assert.equal(
      existsSync(join(root, "ocr", "spring-sb-ocr", "pages", "p0001.jpg")),
      true,
      "OCR 内容提到顶层 ocr/",
    );
    assert.equal(existsSync(join(root, "sources")), false, "空的 sources 目录清掉");
    assert.equal(existsSync(legacy), false, "迁移成功后删除旧目录");

    // 2) 幂等：再跑一次不重复迁移
    const again = await migrateWorkspaceLayout({ root, legacyRoot: legacy, installRoot: install });
    assert.equal(again, "skipped");
  } finally {
    rmSync(install, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  }
}

// 3) 重名冲突：不覆盖已有结果，抛出可读错误（典型场景是上次迁移只做了一半）
{
  const install = temp("install-");
  const legacy = temp("legacy-");
  try {
    const root = join(install, "document");
    mkdirSync(join(root, "ocr", "spring-sb-ocr"), { recursive: true });
    writeFileSync(join(root, "ocr", "spring-sb-ocr", "keep.md"), "新结果");
    mkdirSync(join(root, "sources", "ocr", "spring-sb-ocr"), { recursive: true });
    writeFileSync(join(root, "sources", "ocr", "spring-sb-ocr", "old.md"), "旧结果");
    await assert.rejects(
      () => migrateWorkspaceLayout({ root, legacyRoot: join(legacy, "missing"), installRoot: install }),
      /重名/u,
    );
    assert.equal(
      readFileSync(join(root, "ocr", "spring-sb-ocr", "keep.md"), "utf8"),
      "新结果",
      "不覆盖已有结果",
    );
    assert.equal(
      existsSync(join(root, "sources", "ocr", "spring-sb-ocr", "old.md")),
      true,
      "冲突时保留旧位置，等人工确认",
    );
  } finally {
    rmSync(install, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  }
}

// 4) 新工作区已有内容、没有旧目录：跳过，不动数据
{
  const install = temp("install-");
  const legacy = temp("legacy-");
  try {
    const root = join(install, "document");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "workspace.json"), "{}");
    const result = await migrateWorkspaceLayout({
      root,
      legacyRoot: join(legacy, "missing"),
      installRoot: install,
    });
    assert.equal(result, "skipped");
    assert.equal(existsSync(join(root, "workspace.json")), true);
  } finally {
    rmSync(install, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  }
}

console.log("工作区布局迁移测试通过:4 项");
