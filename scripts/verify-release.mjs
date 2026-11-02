/**
 * 发布包自检：安装包完整性 + 随包资源完整性。
 *
 * 用法：
 *   node scripts/verify-release.mjs [安装包路径]
 *
 * 只做只读检查；通过后把 SHA256 写入 release/SHA256SUMS.txt。
 * 不打印任何密钥内容。
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const releaseDir = join(root, "release");
const unpacked = join(releaseDir, "win-unpacked");

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}
function warn(message) {
  warnings.push(message);
}
function ok(label, detail = "") {
  console.log(`  OK  ${label}${detail ? `（${detail}）` : ""}`);
}

function checkFile(label, file, minBytes = 1) {
  if (!existsSync(file)) {
    fail(`${label} 不存在：${file}`);
    return false;
  }
  const size = statSync(file).size;
  if (size < minBytes) {
    fail(`${label} 大小异常：${size} 字节`);
    return false;
  }
  ok(label, `${(size / 1024 / 1024).toFixed(1)} MB`);
  return true;
}

function checkDir(label, dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`${label} 不存在：${dir}`);
    return false;
  }
  ok(label);
  return true;
}

function hashFile(file, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest(encoding)))
      .on("error", reject);
  });
}

function readLatestYml(file) {
  const result = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const match = /^(\w+):\s*(.+)$/u.exec(line.trim());
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/gu, "");
  }
  return result;
}

console.log("== 安装包 ==");
function newestInstaller() {
  const files = readdirSync(releaseDir)
    .filter((name) => /^AI教材工作台-Setup-.*\.exe$/u.test(name))
    .map((name) => join(releaseDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? "";
}
const installer = process.argv[2] ? join(root, process.argv[2]) : newestInstaller();
if (!checkFile("安装包", installer, 1000 * 1024 * 1024)) {
  console.error(failures.join("\n"));
  process.exit(1);
}
const installerSize = statSync(installer).size;
const sha256 = await hashFile(installer, "sha256", "hex").then((value) => value.toUpperCase());
console.log(`  SHA256 ${sha256}`);
const sha512 = await hashFile(installer, "sha512", "base64");

const latestYml = join(releaseDir, "latest.yml");
if (existsSync(latestYml)) {
  const latest = readLatestYml(latestYml);
  if (Number(latest.size) !== installerSize) {
    fail(`latest.yml size 与安装包不一致：${latest.size} vs ${installerSize}`);
  } else {
    ok("latest.yml size");
  }
  if (latest.sha512 && latest.sha512 !== sha512) {
    fail("latest.yml sha512 与安装包不一致");
  } else if (latest.sha512) {
    ok("latest.yml sha512");
  }
  if (latest.version && !basename(installer).includes(latest.version)) {
    fail(`latest.yml version 与安装包文件名不一致：${latest.version}`);
  }
  if (latest.path && latest.path !== basename(installer)) {
    warn(`latest.yml path 为 ${latest.path}，实际文件名为 ${basename(installer)}（自动更新需改名或调整发布配置）`);
  }
} else {
  warn("缺少 latest.yml，自动更新源不可用");
}

console.log("\n== 随包应用 ==");
checkFile("Electron 主程序", join(unpacked, "AI教材工作台.exe"), 50 * 1024 * 1024);
checkDir("locales", join(unpacked, "locales"));
checkDir("resources", join(unpacked, "resources"));
checkFile("Next server.js", join(unpacked, "resources", "app", "server.js"), 1024);
checkDir("Next node_modules", join(unpacked, "resources", "app", "node_modules", "next"));
checkDir("Next static", join(unpacked, "resources", "app", ".next", "static"));
checkFile("健康检查路由", join(unpacked, "resources", "app", ".next", "server", "app", "api", "health", "route.js"));
checkDir("规则基线", join(unpacked, "resources", "rules"));
checkDir("知识库基线", join(unpacked, "resources", "knowledge"));

if (existsSync(join(unpacked, "document"))) {
  fail("win-unpacked 下存在 document 工作区（试运行残留；发布前删除后重新打包）");
} else {
  ok("未打包 document 工作区");
}
if (existsSync(join(unpacked, "resources", "config", "ai.example.json"))) {
  ok("AI 配置模板");
}
const aiConfig = join(unpacked, "resources", "config", "ai.json");
if (existsSync(aiConfig)) {
  try {
    const config = JSON.parse(readFileSync(aiConfig, "utf8"));
    if (config.baseUrl && config.models?.generation) ok("AI 发布配置");
    else fail("AI 发布配置缺少 baseUrl 或 generation 模型");
    if (config.apiKey) {
      ok("AI Key 已随包配置", `长度 ${String(config.apiKey).length}`);
    } else {
      warn("resources/config/ai.json 未包含 apiKey，老师端需通过 configure:ai 写入");
    }
  } catch {
    fail("resources/config/ai.json 不是合法 JSON");
  }
} else {
  warn("缺少 resources/config/ai.json，安装后 AI 需另行配置");
}

console.log("\n== 随包 OCR ==");
const ocr = join(unpacked, "resources", "ocr");
checkFile("便携 Python", join(ocr, "python", "python.exe"), 1024);
checkFile("venv 入口", join(ocr, "venv", "Scripts", "python.exe"), 1024);
checkDir("MinerU 包", join(ocr, "venv", "Lib", "site-packages", "mineru"));
checkFile(
  "pipeline 布局模型",
  join(ocr, "models", "pipeline", "models", "Layout", "PP-DocLayoutV2", "config.json"),
);
checkFile(
  "pipeline OCR 模型",
  join(ocr, "models", "pipeline", "models", "OCR", "paddleocr_torch", "ch_PP-OCRv6_small_rec_infer.safetensors"),
);
if (existsSync(join(ocr, "licenses"))) ok("OCR 许可清单");
else warn("缺少 OCR licenses 目录");

console.log("\n== 版本 ==");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const appPkg = JSON.parse(readFileSync(join(unpacked, "resources", "app", "package.json"), "utf8"));
if (pkg.version === appPkg.version) ok(`版本 ${pkg.version}`);
else fail(`package.json 版本 ${pkg.version} 与随包服务 ${appPkg.version} 不一致`);

if (failures.length) {
  console.error("\n发布自检未通过：");
  for (const message of failures) console.error(`  FAIL ${message}`);
  if (warnings.length) {
    console.error("\n警告：");
    for (const message of warnings) console.error(`  WARN ${message}`);
  }
  process.exit(1);
}

writeFileSync(
  join(releaseDir, "SHA256SUMS.txt"),
  `${sha256}  ${basename(installer)}\n`,
  "utf8",
);
console.log(`\n发布自检通过，已写入 ${join(releaseDir, "SHA256SUMS.txt")}`);
if (warnings.length) {
  console.log("\n警告：");
  for (const message of warnings) console.log(`  WARN ${message}`);
}
