/**
 * 组装 Electron 需要的 Next standalone 产物。
 *
 * Next 不会自动把 `.next/static` 与 `public` 放进 standalone，桌面壳启动后会 404；
 * 这里在 `next build` 之后补齐。OCR 运行时由 `scripts/build-ocr-runtime.ps1`
 * 生成到 `build/ocr`，不提交 git。
 */

import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copy(from, to) {
  if (!(await exists(from))) throw new Error(`缺少构建产物：${from}`);
  await mkdir(dirname(to), { recursive: true }).catch(() => undefined);
  await cp(from, to, { recursive: true, force: true });
}

if (!(await exists(join(standalone, "server.js")))) {
  throw new Error("找不到 .next/standalone/server.js，请先运行 npm run build（next.config 需 output: standalone）");
}

await copy(join(root, ".next", "static"), join(standalone, ".next", "static"));
await copy(join(root, "public"), join(standalone, "public"));
// standalone 的 trace 偶尔漏掉 server chunks（实测缺 2400.js，运行时报
// "Cannot find module './chunks/2400.js'"）；整目录补齐，成本很小。
await copy(join(root, ".next", "server", "chunks"), join(standalone, ".next", "server", "chunks"));

if (!(await exists(join(root, "resources", "rules")))) {
  throw new Error("缺少 resources/rules 基线");
}
if (!(await exists(join(root, "resources", "knowledge")))) {
  throw new Error("缺少 resources/knowledge 基线");
}

const collections = join(root, "build", "knowledge-collections");
if (!(await exists(collections))) {
  console.warn("[警告] 没有 build/knowledge-collections，安装包将不带范本集合；先运行 npm run stage:collections。");
}

const ocr = join(root, "build", "ocr");
if (await exists(join(ocr, "venv", "Scripts", "python.exe"))) {
  console.log(`OCR 运行时已就绪：${ocr}`);
} else {
  console.warn(
    `[警告] 没有 build/ocr 运行时，安装包将不含 OCR。\n` +
      `先运行 scripts/build-ocr-runtime.ps1 生成，再重新执行 dist:win。`,
  );
}

console.log("desktop 准备完成：.next/standalone 已补齐 static/public");
