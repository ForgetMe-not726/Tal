/**
 * 资料库文件夹名的磁盘侧辅助（目录列表、建目录）。
 *
 * 与 `naming.ts` 分开：那边是纯函数，客户端组件也要用；
 * 这里带 `node:fs`，只能被服务端代码引用。
 */

import { mkdir, readdir } from "node:fs/promises";
import type { BookType } from "../db/types.ts";
import type { Term } from "../types.ts";
import { ocrJobDir, ocrLibraryDir } from "../workspace/paths.ts";
import { BOOK_DIR_KEY } from "./naming.ts";

/** 当前资料库里已有的文件夹名（资料库目录可能还不存在）。 */
export async function existingLibraryDirNames(): Promise<Set<string>> {
  try {
    return new Set(await readdir(ocrLibraryDir()));
  } catch {
    return new Set();
  }
}

export async function ensureLibraryDir(): Promise<void> {
  await mkdir(ocrLibraryDir(), { recursive: true });
}

/**
 * 原子地占用一个资料库文件夹名：`mkdir` 成功即占用，重名就换下一个序号。
 * 两个导入同时发生时也不会挑到同一个名字。
 */
export async function createLibraryDir(term: Term, bookType: BookType): Promise<string> {
  await ensureLibraryDir();
  const base = `${term}-${BOOK_DIR_KEY[bookType]}-ocr`;
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? base : `${base}-${index}`;
    try {
      await mkdir(ocrJobDir(name));
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
}
