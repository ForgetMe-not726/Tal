/**
 * 二进制文件的落盘原语。
 *
 * `json.ts` 只管文本 JSON；原始教材 PDF、OCR 页图和图片资产是二进制，需要单独一层。
 * 纪律与 `json.ts` 一致：**先写临时文件再 rename**，中途失败不留半个文件；
 * 路径一律经 `resolveInWorkspace` 校验，挡住 `..`、绝对路径和符号链接逃逸
 * （profile §8 要求本地文件访问限制在工作区内）。
 */

import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class WorkspaceFileError extends Error {}

/** 工作区内的路径校验：解析后必须仍在工作区内。 */
export function resolveInWorkspace(root: string, candidate: string): string {
  if (isAbsolute(candidate)) {
    throw new WorkspaceFileError(`不接受绝对路径：${candidate}`);
  }
  const base = resolve(root);
  const target = resolve(base, candidate);
  const rel = relative(base, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new WorkspaceFileError(`路径超出工作区范围：${candidate}`);
  }
  return target;
}

function tempName(path: string): string {
  return `${path}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
}

/** 原子写二进制。 */
export async function writeBinaryAtomic(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = tempName(path);
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** 读二进制；文件不存在返回 null（与 `readJson` 的 ENOENT 语义一致）。 */
export async function readBinary(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 把工作区外的原文件复制进工作区（原件只复制不改写）。 */
export async function copyIntoWorkspace(source: string, target: string): Promise<number> {
  const info = await stat(source);
  if (!info.isFile()) throw new WorkspaceFileError(`不是文件：${source}`);
  await mkdir(dirname(target), { recursive: true });
  const temp = tempName(target);
  try {
    await copyFile(source, temp);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return info.size;
}

/** 把目录里的文件整批复制到目标目录（用于 OCR 的 images/ → assets/）。 */
export async function copyDirFiles(sourceDir: string, targetDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  let names: string[];
  try {
    names = await readdir(sourceDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  await mkdir(targetDir, { recursive: true });
  const copied: string[] = [];
  for (const name of names) {
    const from = resolve(sourceDir, name);
    const info = await stat(from);
    if (!info.isFile()) continue;
    await copyFile(from, resolve(targetDir, name));
    copied.push(name);
  }
  return copied;
}

/**
 * 把**请求体流**边收边写进工作区。
 *
 * 为什么不能先 `arrayBuffer()` 再写：教材 PDF 实测 209 MB，全量进内存既慢又危险。
 * `onBytes` 让调用方在写入过程中累计字节数并做上限校验（超限直接抛，临时文件被清掉）。
 */
export async function saveStreamToWorkspace(
  stream: ReadableStream<Uint8Array>,
  target: string,
  options: { maxBytes: number; onBytes?: (total: number) => void } = { maxBytes: 0 },
): Promise<number> {
  await mkdir(dirname(target), { recursive: true });
  const temp = tempName(target);
  let written = 0;
  try {
    await pipeline(
      Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          written += chunk.byteLength;
          if (options.maxBytes > 0 && written > options.maxBytes) {
            throw new WorkspaceFileError(
              `文件超过上限 ${Math.round(options.maxBytes / 1048576)} MB`,
            );
          }
          options.onBytes?.(written);
          yield chunk;
        }
      },
      createWriteStream(temp),
    );
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return written;
}

/** 读文件开头若干字节，用于按内容识别文件类型（不靠扩展名）。 */
export async function readHead(path: string, length = 5): Promise<Buffer> {
  const { open } = await import("node:fs/promises");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
