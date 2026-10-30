/**
 * Electron 桌面壳（首版交付）。
 *
 * 只做四件事：选本机端口 → 启动随包 Next standalone 服务 → 等健康检查 → 打开窗口。
 * 业务仍在 Next 服务里，窗口只访问 127.0.0.1，不监听局域网。
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const isWindows = process.platform === "win32";

// 开发壳与安装包使用不同的 userData，避免单实例锁互相顶掉。
const appData = app.getPath("appData");
const appName = app.isPackaged ? "AI教材工作台" : "AI教材工作台-dev";
app.setName(appName);
app.setPath("userData", path.join(appData, appName));

let serverProcess = null;
let mainWindow = null;
let installRoot = null;
let documentDir = null;
let logDir = null;

function resolvePaths() {
  installRoot = app.isPackaged ? path.dirname(process.resourcesPath) : process.cwd();
  documentDir = path.join(installRoot, "document");
  logDir = path.join(documentDir, ".app", "logs");
  fs.mkdirSync(logDir, { recursive: true });
}

function logLine(kind, text) {
  const line = `[${new Date().toISOString()}] [${kind}] ${text}`;
  try {
    fs.appendFileSync(path.join(logDir, "desktop.log"), `${line}\n`, "utf8");
  } catch {
    // 日志目录不可写时不能阻断启动
  }
  if (!app.isPackaged) console.log(line);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 随包的非敏感 AI 配置（provider/baseUrl/模型名）。 */
function readAiConfig() {
  const file = path.join(process.resourcesPath, "config", "ai.json");
  return app.isPackaged ? readJson(file) : null;
}

/** API Key 只放在 DPAPI 加密文件里，老师不编辑 .env。 */
function readAiKey() {
  try {
    const file = path.join(app.getPath("userData"), "ai-key.bin");
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function aiEnv() {
  const config = readAiConfig() ?? {};
  const env = {};
  if (config.provider) env.AI_PROVIDER = config.provider;
  if (config.baseUrl) env.AI_BASE_URL = config.baseUrl;
  if (config.authMode) env.AI_AUTH_MODE = config.authMode;
  if (config.temperature != null) env.AI_TEMPERATURE = String(config.temperature);
  for (const [task, key] of [
    ["generation", "AI_MODEL_GENERATION"],
    ["review", "AI_MODEL_REVIEW"],
    ["vision", "AI_MODEL_VISION"],
  ]) {
    if (config.models?.[task]) env[key] = config.models[task];
  }
  const key = readAiKey();
  if (key) env.AI_API_KEY = key;
  return env;
}

/**
 * 随包 MinerU 的模型配置写成绝对路径。
 *
 * 不写 ~/.mineru.json：安装目录可能被老师改，写在 document/.app/ocr 下，
 * 既不污染用户目录，也随工作区一起备份。
 */
/** 便携 venv 的 pyvenv.cfg 记录了构建机路径；启动时改成实际安装路径。 */
function ensurePortablePython() {
  if (!app.isPackaged) return;
  const ocrHome = path.join(process.resourcesPath, "ocr");
  const pythonHome = path.join(ocrHome, "python");
  const cfg = path.join(ocrHome, "venv", "pyvenv.cfg");
  if (!fs.existsSync(cfg) || !fs.existsSync(pythonHome)) return;
  const lines = fs
    .readFileSync(cfg, "utf8")
    .split(/\r?\n/u)
    .filter((line) => !/^(home|executable|command)\s*=/iu.test(line));
  lines.push(`home = ${pythonHome}`, `executable = ${path.join(pythonHome, "python.exe")}`);
  fs.writeFileSync(cfg, `${lines.join("\n")}\n`, "utf8");
}

function writeMineruConfig() {
  if (!app.isPackaged) return null;
  const ocrHome = path.join(process.resourcesPath, "ocr");
  const pipeline = path.join(ocrHome, "models", "pipeline");
  if (!fs.existsSync(pipeline)) return null;
  const dir = path.join(documentDir, ".app", "ocr");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "mineru.json");
  const config = {
    "models-dir": { pipeline },
    "model-source": "local",
    "config_version": "1.3.2",
  };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return file;
}

async function waitForHealth(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { cache: "no-store" });
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`本地服务启动超时：${lastError}`);
}

async function startServer() {
  if (!app.isPackaged && process.env.DESKTOP_USE_STANDALONE !== "1") {
    return { url: process.env.DESKTOP_DEV_URL || "http://127.0.0.1:3000", owned: false };
  }

  const appDir = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(process.cwd(), ".next", "standalone");
  const serverEntry = path.join(appDir, "server.js");
  if (!fs.existsSync(serverEntry)) throw new Error(`找不到本地服务：${serverEntry}`);

  ensurePortablePython();
  const port = await freePort();
  const configPath = writeMineruConfig();
  const env = {
    ...process.env,
    ...aiEnv(),
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    AI_TEACHING_INSTALL_DIR: installRoot,
    APP_VERSION: app.getVersion(),
  };
  if (app.isPackaged) {
    env.MINERU_HOME = path.join(process.resourcesPath, "ocr");
    if (configPath) env.MINERU_TOOLS_CONFIG_JSON = configPath;
  }

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: appDir,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", (chunk) => logLine("server", chunk.toString("utf8").trim()));
  serverProcess.stderr?.on("data", (chunk) => logLine("server", chunk.toString("utf8").trim()));
  serverProcess.on("exit", (code, signal) => {
    logLine("server", `exit code=${code} signal=${signal}`);
    if (mainWindow && !app.isQuitting) {
      dialog.showErrorBox(
        "本地服务已停止",
        `AI 教材工作台的后台服务意外退出（code=${code}）。\n日志：${path.join(logDir, "desktop.log")}`,
      );
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForHealth(url);
  logLine("desktop", `server ready at ${url}`);
  return { url, owned: true };
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    if (isWindows) {
      spawn("taskkill", ["/PID", String(serverProcess.pid), "/T", "/F"], { windowsHide: true });
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch (error) {
    logLine("desktop", `stop server failed: ${error.message}`);
  }
  serverProcess = null;
}

function windowStateFile() {
  return path.join(app.getPath("userData"), "window.json");
}

function loadWindowState() {
  const state = readJson(windowStateFile());
  return {
    width: Number.isInteger(state?.width) ? state.width : 1440,
    height: Number.isInteger(state?.height) ? state.height : 900,
    x: Number.isInteger(state?.x) ? state.x : undefined,
    y: Number.isInteger(state?.y) ? state.y : undefined,
  };
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify(bounds), "utf8");
  } catch {
    // 忽略
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    ...loadWindowState(),
    minWidth: 1100,
    minHeight: 700,
    title: "AI 教材工作台",
    backgroundColor: "#e9edf1",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const origin = new URL(url).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/u.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      if (/^https?:/u.test(target)) void shell.openExternal(target);
    }
  });

  void mainWindow.loadURL(url);
}

function registerDownloads() {
  session.defaultSession.on("will-download", (event, item) => {
    const suggested = path.join(app.getPath("downloads"), item.getFilename());
    const result = dialog.showSaveDialogSync(mainWindow ?? undefined, {
      defaultPath: suggested,
      title: "保存导出文件",
    });
    if (result) item.setSavePath(result);
    else item.cancel();
  });
}

async function bootstrap() {
  resolvePaths();
  logLine("desktop", `app ${app.getVersion()} root=${installRoot}`);
  Menu.setApplicationMenu(null);
  registerDownloads();
  ipcMain.handle("desktop:open-logs", () => shell.openPath(logDir));
  ipcMain.handle("desktop:open-workspace", () => shell.openPath(documentDir));

  try {
    const { url } = await startServer();
    createWindow(url);
  } catch (error) {
    logLine("desktop", `startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox(
      "AI 教材工作台启动失败",
      `${error.message}\n\n日志：${path.join(logDir, "desktop.log")}`,
    );
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    stopServer();
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(async () => {
    try {
      await bootstrap();
    } catch (error) {
      try {
        logLine("desktop", `bootstrap failed: ${error.stack || error.message}`);
      } catch {
        // 日志目录可能不可写
      }
      dialog.showErrorBox(
        "AI 教材工作台启动失败",
        `${error.message}

日志：${path.join(logDir ?? os.tmpdir(), "desktop.log")}`,
      );
      app.quit();
    }
  });
}
