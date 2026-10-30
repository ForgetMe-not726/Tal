/**
 * 从本地 `.env.local` 生成桌面版 AI 配置。
 *
 * 这是公司内部工具，按需求方要求使用本地 Key：
 * - 生成 `resources/config/ai.json`（随安装包分发，含 provider/baseUrl/models/apiKey）；
 * - 如果本机已安装桌面版，同时写入安装目录的 config，并用 Electron safeStorage
 *   把 Key 加密写到 `%APPDATA%\AI教材工作台\ai-key.bin`。
 *
 * 不打印任何密钥；`resources/config/ai.json` 不提交 git。
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const buildOnly = process.argv.includes("--build-only");
const envPath = join(root, ".env.local");
if (!existsSync(envPath)) throw new Error("缺少 .env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/u)) {
  const text = line.trim();
  if (!text || text.startsWith("#")) continue;
  const index = text.indexOf("=");
  if (index < 0) continue;
  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim().replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1");
  if (key) env[key] = value;
}
if (!env.AI_BASE_URL || !env.AI_API_KEY) throw new Error(".env.local 缺少 AI_BASE_URL 或 AI_API_KEY");

const config = {
  provider: env.AI_PROVIDER || "anthropic-compatible",
  baseUrl: env.AI_BASE_URL,
  authMode: env.AI_AUTH_MODE || "",
  temperature: env.AI_TEMPERATURE ? Number(env.AI_TEMPERATURE) : null,
  models: {
    generation: env.AI_MODEL_GENERATION || "",
    review: env.AI_MODEL_REVIEW || "",
    vision: env.AI_MODEL_VISION || "",
  },
  // 内部工具：随安装包分发；如改用凭据库，删除此字段即可
  apiKey: env.AI_API_KEY,
};

const repoConfig = join(root, "resources", "config", "ai.json");
mkdirSync(join(root, "resources", "config"), { recursive: true });
writeFileSync(repoConfig, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`已生成 ${repoConfig}`);

// 已安装桌面版：同步 config，并用 DPAPI 写一份加密 Key
const localAppData = process.env.LOCALAPPDATA || "";
const installDir = localAppData ? join(localAppData, "Programs", "ai-textbook-workbench") : "";
const installedConfig = installDir ? join(installDir, "resources", "config", "ai.json") : "";
if (!buildOnly && installDir && existsSync(installDir)) {
  mkdirSync(join(installDir, "resources", "config"), { recursive: true });
  copyFileSync(repoConfig, installedConfig);
  const electron = join(root, "node_modules", "electron", "dist", "electron.exe");
  if (existsSync(electron)) {
    const keyFile = join(tmpdir(), `ai-key-${process.pid}.txt`);
    writeFileSync(keyFile, env.AI_API_KEY, "utf8");
    try {
      execFileSync(electron, [join(root, "electron", "set-ai-key.cjs"), keyFile], {
        stdio: ["ignore", "inherit", "inherit"],
      });
    } finally {
      rmSync(keyFile, { force: true });
    }
    console.log(`已同步安装版配置：${installedConfig}`);
  }
}

console.log("AI 配置完成（未输出密钥）");
