/**
 * 一次性写入 AI API Key 到 Electron safeStorage（Windows DPAPI）。
 *
 * 由 scripts/configure-desktop-ai.mjs 调用，Key 从 stdin 传入，不出现在命令行/日志。
 * 写入位置与安装包主进程一致：%APPDATA%\AI教材工作台\ai-key.bin。
 */
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const appData = app.getPath("appData");
app.setName("AI教材工作台");
app.setPath("userData", path.join(appData, "AI教材工作台"));

app.whenReady().then(() => {
  const keyFile = process.argv[2];
  let key = "";
  try {
    if (keyFile) key = fs.readFileSync(keyFile, "utf8").trim();
  } catch {
    // 下面统一报错
  }
  try {
    if (keyFile) fs.rmSync(keyFile, { force: true });
  } catch {
    // 临时文件删不掉不影响写入
  }
  if (!key) {
    console.error("缺少 API Key（未提供临时文件）");
    app.exit(2);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    console.error("系统加密不可用，无法安全保存 API Key");
    app.exit(3);
    return;
  }
  const dir = path.join(appData, "AI教材工作台");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ai-key.bin"), safeStorage.encryptString(key));
  console.log(`AI Key 已加密保存：${path.join(dir, "ai-key.bin")}`);
  app.exit(0);
});
