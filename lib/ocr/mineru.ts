/**
 * MinerU CLI adapter。**唯一允许 spawn 外部进程的地方**（`docs/OCR-ENGINE-DECISION.md` 的适配契约）。
 *
 * 实测（3.4.5，已核对源码与真实产物）：
 * - 没有子命令，`mineru -p <pdf> -o <out> -b pipeline -m ocr -l ch`；
 * - **必须显式 `-b pipeline`**：默认是 `hybrid-engine`，CPU 上实测 21 分钟跑不完、单进程 4.3 GB；
 * - 输出子目录由 backend+method 决定（`pipeline` → `<out>/<stem>/<method>/`），**不能硬编码**；
 * - 进度打在 **stderr**（loguru），形如 `Completed batch 1/1 | Processed 52/52 pages | …`；
 * - 不给 `--api-url` 时 CLI 会再拉起一个 `mineru-api` 子进程，所以**取消必须杀进程树**。
 *
 * 引擎路径不写死：`MINERU_HOME`（默认 `~/.venvs/mineru`）。将来换成随包 sidecar 时，
 * 只换这一层的可执行文件解析，业务层不动。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type MineruRunOptions = {
  /** 后端：`pipeline`（默认，CPU 可用）或 `vlm-engine` / `hybrid-engine`。 */
  backend?: string;
  /** `auto` / `txt` / `ocr`——它同时决定输出子目录名。 */
  method?: string;
  language?: string;
  /** 页码范围（0 起，含两端）；不给就是整本。 */
  startPage?: number;
  endPage?: number;
};

export const DEFAULT_MINERU_OPTIONS: Required<Pick<MineruRunOptions, "backend" | "method" | "language">> =
  { backend: "pipeline", method: "ocr", language: "ch" };

export class MineruError extends Error {}

/** 引擎安装目录：`MINERU_HOME` 优先，默认用户目录下的 venv。 */
export function mineruHome(): string {
  const override = process.env.MINERU_HOME?.trim();
  return override ? override : join(homedir(), ".venvs", "mineru");
}

/** 可执行文件（Windows 是 `Scripts/mineru.exe`，类 Unix 是 `bin/mineru`）。 */
export function mineruExecutable(home = mineruHome()): string {
  return process.platform === "win32" ? join(home, "Scripts", "mineru.exe") : join(home, "bin", "mineru");
}

/** venv 的解释器，页图渲染要用它（pypdfium2 装在这里面）。 */
export function mineruPython(home = mineruHome()): string {
  return process.platform === "win32"
    ? join(home, "Scripts", "python.exe")
    : join(home, "bin", "python");
}

/**
 * 引擎配置。CLI 用 `~/.mineru.json` 找模型目录；以别的账户身份跑时找不到会**重新下载模型**，
 * 所以显式指过去——存在才设，不覆盖用户自己的配置。
 */
export function mineruEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const config = join(homedir(), "mineru.json");
  if (!env.MINERU_TOOLS_CONFIG_JSON && existsSync(config)) {
    env.MINERU_TOOLS_CONFIG_JSON = config;
  }
  return env;
}

/** 引擎是否就绪；不ready 时返回可读原因，而不是等到 spawn 才崩。 */
export async function checkMineru(home = mineruHome()): Promise<{ ready: boolean; reason?: string }> {
  const exe = mineruExecutable(home);
  try {
    await access(exe);
  } catch {
    return {
      ready: false,
      reason: `找不到 OCR 引擎：${exe}。请确认已安装 MinerU，或用环境变量 MINERU_HOME 指定安装目录。`,
    };
  }
  return { ready: true };
}

/** 引擎命令（纯函数，便于单测）。 */
export function mineruCommand(input: {
  executable: string;
  pdfPath: string;
  outDir: string;
  options?: MineruRunOptions;
}): string[] {
  const options = { ...DEFAULT_MINERU_OPTIONS, ...input.options };
  const args = [input.executable, "-p", input.pdfPath, "-o", input.outDir];
  args.push("-b", options.backend, "-m", options.method, "-l", options.language);
  if (typeof input.options?.startPage === "number") args.push("-s", String(input.options.startPage));
  if (typeof input.options?.endPage === "number") args.push("-e", String(input.options.endPage));
  return args;
}

/** 上游产物的落点：`<out>/<stem>/<method>/`，method 随 `-m` 变，所以按目录扫而不是拼字符串。 */
export type UpstreamFiles = {
  dir: string;
  contentListPath: string;
  middlePath: string;
  originPdfPath: string;
  imagesDir: string;
  /** 引擎自己输出的 Markdown（丢页眉页脚，只作对照，不作课边界依据）。 */
  markdownPath: string | null;
};

export async function locateUpstream(outDir: string, method: string): Promise<UpstreamFiles> {
  // 三种落点都要认：老师直接指向产物目录、指向 CLI 的输出根、或指向 `<out>/<stem>`。
  const candidates: string[] = [outDir, join(outDir, method)];
  for (const name of await readdir(outDir).catch(() => [] as string[])) {
    const child = join(outDir, name);
    if (!(await isDirectory(child))) continue;
    candidates.push(child, join(child, method));
  }
  for (const dir of candidates) {
    const found = await tryDir(dir);
    if (found) return found;
  }
  throw new MineruError(
    `在 ${outDir} 里找不到 OCR 产物（需要 *_content_list.json 与 *_middle.json）`,
  );
}

async function tryDir(dir: string): Promise<UpstreamFiles | null> {
  const files = await readdir(dir).catch(() => null);
  if (!files) return null;
  const find = (suffix: string) => files.find((name) => name.endsWith(suffix));
  const contentList = find("_content_list.json");
  const middle = find("_middle.json");
  if (!contentList || !middle) return null;
  const origin = find("_origin.pdf");
  const markdownFile = find(".md");
  const markdown = markdownFile && !markdownFile.endsWith("_paged.md") ? markdownFile : null;
  return {
    dir,
    contentListPath: join(dir, contentList),
    middlePath: join(dir, middle),
    originPdfPath: origin ? join(dir, origin) : "",
    imagesDir: join(dir, "images"),
    markdownPath: markdown ? join(dir, markdown) : null,
  };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 进度行的解析（纯函数）。拿不到就返回 null——**不编造百分比**。 */
/** 上游阶段的中文名：界面直接显示，不把 MinerU 的英文阶段名丢给老师。 */
const PHASE_LABEL: Record<string, string> = {
  "ocr-rec predict": "文字识别",
  "ocr-det ch": "文字检测",
  "ocr-det": "文字检测",
  "layout predict": "版面分析",
  "table-ocr rec ch": "表格文字",
  "table-ocr det": "表格检测",
  "table orientation det": "表格方向",
  "table orientation score": "表格方向",
  "table orientation": "表格方向",
  "table-wireless predict": "表格识别",
  "table-wired predict": "表格识别",
  "seal predict": "印章检测",
  "processing pages": "页面处理",
};

export type MineruProgress =
  /** 页级进度：`done/total` 都是页数。 */
  | { kind: "pages"; done: number | null; total: number }
  /** 其它阶段：只有百分比。**不能当页数**——`OCR-rec 1668/1668` 是文字区域。 */
  | { kind: "phase"; label: string; percent: number };

function phaseLabel(raw: string): string {
  const key = raw.trim().replace(/[:：]\s*$/, "").toLocaleLowerCase();
  return PHASE_LABEL[key] ?? raw.trim();
}

/**
 * 解析 MinerU 的一行日志。
 *
 * **页数只认页级阶段**：`Processing pages: 41/83`、`Layout Predict: 16/52`
 * （且 `Layout Predict` 在分批时可能是 `19/19`，所以给了 `expectedTotal` 就必须核对）。
 * 其余 tqdm 条是**区域/批次**（`OCR-rec Predict: 1668/1668`），只取百分比用来显示"还在跑"。
 *
 * 这条区别很关键：一本 83 页的书，文字识别阶段要跑 3 分钟，旧实现把它当页数、
 * 又因为分母对不上而丢弃，界面就一直是 0/83——看起来像卡死。
 */
export function parseProgress(
  line: string,
  expectedTotal?: number | null,
): MineruProgress | null {
  const bar = /^\s*([^|]{2,40}?):\s*(\d+)%.*?(\d+)\/(\d+)\s*\[/u.exec(line);
  if (bar) {
    const label = bar[1]!.trim();
    const done = Number(bar[3]);
    const total = Number(bar[4]);
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
    const pageLevel = /^(?:layout predict|processing pages)$/iu.test(label);
    if (pageLevel) {
      if (done > total) return null;
      // 分批时 Layout Predict 的分母可能只是本批页数，和真实页数对不上就丢掉
      if (expectedTotal != null && total !== expectedTotal) return null;
      return { kind: "pages", done, total };
    }
    return { kind: "phase", label: phaseLabel(label), percent: Math.min(100, Math.round((done / total) * 100)) };
  }
  const processed = /Processed\s+(\d+)\s*\/\s*(\d+)\s+pages/i.exec(line);
  if (processed) {
    const done = Number(processed[1]);
    const total = Number(processed[2]);
    if (Number.isFinite(done) && Number.isFinite(total) && total > 0) {
      if (expectedTotal != null && total !== expectedTotal) return null;
      return { kind: "pages", done: Math.min(done, total), total };
    }
  }
  const totalOnly = /(\d+)\s+pages total/i.exec(line);
  if (totalOnly) {
    const total = Number(totalOnly[1]);
    if (Number.isFinite(total) && total > 0) {
      if (expectedTotal != null && total !== expectedTotal) return null;
      return { kind: "pages", done: null, total };
    }
  }
  return null;
}

export type MineruHandle = {
  pid: number | undefined;
  /** 进程结束时 resolve；非 0 退出抛错。 */
  done: Promise<void>;
  /**
   * 上游日志尾部（最近的若干行）。
   *
   * 失败时要落进任务记录：老师看到"识别失败"却没有任何线索是最糟的体验。
   * 做成函数而不是值，是因为它要反映**调用时刻**的尾部。
   */
  logTail: () => string[];
  /** 杀进程树（Windows 用 taskkill /T；否则杀进程组）。 */
  cancel: () => void;
};

const LOG_TAIL_LINES = 40;

/**
 * 启动一次识别。**不等待**——调用方拿 `done` 去更新任务状态，路由立即返回。
 */
export function spawnMineru(input: {
  pdfPath: string;
  outDir: string;
  options?: MineruRunOptions;
  /** PDF 的真实页数；给了就只认分母与它一致的进度（过滤掉区域数）。 */
  expectedPages?: number | null;
  onProgress?: (progress: MineruProgress) => void;
}): MineruHandle {
  const executable = mineruExecutable();
  const [command, ...args] = mineruCommand({ executable, ...input });
  const child: ChildProcess = spawn(command, args, {
    env: mineruEnv(),
    windowsHide: true,
  });

  const logTail: string[] = [];
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      // 上游用 loguru，日志带 ANSI 颜色转义；落进任务记录前去掉，否则界面里全是乱码
      const trimmed = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (!trimmed) continue;
      // tqdm 每次刷新都会输出一行，几十页就能把真正的错误挤出尾部。
      // 同一阶段（前缀相同）只保留最新一行。
      const prefix = trimmed.replace(/\d.*$/u, "");
      const duplicate = logTail.findIndex((existing) => existing.replace(/\d.*$/u, "") === prefix);
      if (duplicate >= 0) logTail.splice(duplicate, 1);
      logTail.push(trimmed);
      if (logTail.length > LOG_TAIL_LINES) logTail.shift();
      const progress = parseProgress(trimmed, input.expectedPages);
      if (progress) input.onProgress?.(progress);
    }
  };
  // 进度打在 stderr；stdout 也收，避免管道写满把子进程卡住。
  child.stderr?.on("data", push);
  child.stdout?.on("data", push);

  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    child.on("error", (error) => {
      rejectPromise(new MineruError(`启动 OCR 引擎失败：${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new MineruError(
          `OCR 引擎退出码 ${code}：${logTail.slice(-3).join(" / ") || "（没有日志）"}`,
        ),
      );
    });
  });

  return {
    pid: child.pid,
    done,
    logTail: () => [...logTail],
    cancel: () => cancelProcessTree(child.pid),
  };
}

/** 取消：必须杀**进程树**，否则会留下占几 GB 内存的 `mineru-api` 孤儿进程。 */
export function cancelProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).on(
      "error",
      () => undefined,
    );
    return;
  }
  try {
    // 负号 = 整个进程组
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 已经退出
    }
  }
}

/** 进程是否还活着——用于判定"服务重启后遗留的 running 任务"。 */
export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 说明进程存在但没有权限（仍是活着）
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
