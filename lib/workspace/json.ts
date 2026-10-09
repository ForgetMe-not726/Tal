/**
 * 本地工作区的 JSON 读写。
 *
 * 本地文件是唯一事实源，所以写必须**原子**：先写临时文件再 rename。
 * 直接覆写的话，进程在写到一半时被杀（老师关掉应用、机器断电）会留下半个 JSON，
 * 而这个文件是事实源，损坏就等于丢数据。
 *
 * 并发方面：同一个文件的"读-改-写"用按路径的异步互斥锁串起来，
 * 避免两个请求同时改一个文件时后写的覆盖先写的。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const locks = new Map<string, Promise<unknown>>();

/** 同一个路径上的操作串行执行。 */
export function withFileLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  // 前一个任务失败不能阻断后续任务，所以 catch 掉再串。
  const next = previous.then(task, task);
  locks.set(
    path,
    next.catch(() => undefined),
  );
  return next;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** 读 JSON。文件不存在返回 fallback；内容损坏时抛错而不是静默给默认值。 */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`工作区文件损坏，无法解析 JSON：${path}（${(error as Error).message}）`);
  }
}

/** 原子写 JSON：临时文件 + rename。 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  // 临时文件放在同目录，保证 rename 是同一文件系统内的原子操作。
  const temp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** 读-改-写，整体加锁。 */
export async function updateJson<T>(
  path: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  return withFileLock(path, async () => {
    const current = await readJson(path, fallback);
    const next = await mutate(current);
    await writeJson(path, next);
    return next;
  });
}

/** 列出目录下的条目；目录不存在返回空数组。 */
export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** 读取目录下所有 .json **文件**（`dir/<name>.json`）。 */
export async function readJsonDir<T>(path: string): Promise<T[]> {
  const names = (await listDir(path)).filter((name) => name.endsWith(".json")).sort();
  const values: T[] = [];
  for (const name of names) {
    values.push(await readJson<T>(join(path, name), null as unknown as T));
  }
  return values;
}

/**
 * 读取「每个子目录里一个 JSON」形式的集合（`dir/<子目录>/<fileName>`）。
 *
 * 项目、课时、书、模块都是这种形状——按 ID 或标识建目录，元数据放在目录里。
 * 缺文件或内容为 null 的条目跳过（空目录不参与）。
 */
export async function readJsonFromSubdirs<T>(dir: string, fileName: string): Promise<T[]> {
  const values: T[] = [];
  for (const name of (await listDir(dir)).sort()) {
    const value = await readJson<T | null>(join(dir, name, fileName), null);
    if (value) values.push(value);
  }
  return values;
}

export async function removeFile(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 测试用：清空锁表，避免跨用例互相阻塞。 */
export function resetLocksForTests(): void {
  locks.clear();
}
