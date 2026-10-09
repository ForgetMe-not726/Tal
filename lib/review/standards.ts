/**
 * 审校判据材料：按规则的 `standard_refs` **按引用精确取用**。
 *
 * 判据是公司审校标准里的 `references/*.md`（随包基线装进 `<ws>/knowledge/review-standards/`）。
 * 规则里的引用形如：
 *   `references/review-standards.md:3、3.1`      → 按小节号取（§3 与 §3.1）
 *   `references/grammar-review.md:通用语法审校门槛` → 按小节标题取
 *
 * 为什么不整本塞进 Prompt：四份材料加起来 140 KB（`docs/AI-ASSISTANT-RETRIEVAL.md` §2
 * 明确要求按需加入、带来源定位）。为什么不模糊匹配：引用是标准自己给的，
 * 按它取用即可——匹配不上就**如实说取不到**，不猜。
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { knowledgeDir } from "../workspace/paths.ts";

/** 判据材料在知识目录下的子目录（与 `scripts/convert-review-skill.mjs` 的输出一致）。 */
export const STANDARDS_DIR_NAME = "review-standards";

export type StandardSection = {
  /** 所属文件（`references/review-standards.md` 这种原标准里的写法）。 */
  file: string;
  /** 小节号（`3`、`3.1`）或小节标题。 */
  label: string;
  title: string;
  content: string;
};

/**
 * 把一份判据材料按二级/三级标题切成小节。**纯函数**，便于单测。
 *
 * 小节号从标题里取（`## 3. 严格 Cambridge 英式英语` → `3`；`### 3.1 …` → `3.1`），
 * 取不到号就用标题本身当标签（`## 4. 通用语法审校门槛` → 同时认 `4` 和标题）。
 */
export function parseStandardSections(markdown: string, file: string): StandardSection[] {
  const lines = markdown.split("\n");
  const sections: StandardSection[] = [];
  let current: { level: number; heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line);
    if (match) {
      if (current) sections.push(build(current, file));
      current = { level: match[1].length, heading: match[2].trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(build(current, file));
  return sections;
}

function build(
  section: { heading: string; lines: string[] },
  file: string,
): StandardSection {
  const numbered = /^(\d+(?:\.\d+)*)[.、]?\s*(.*)$/u.exec(section.heading);
  return {
    file,
    label: numbered?.[1] ?? section.heading,
    title: section.heading,
    content: section.lines.join("\n").trim(),
  };
}

/** 一个引用里的文件与要取的小节（`references/review-standards.md:3、3.1`）。 */
export function parseStandardRef(ref: string): { file: string; labels: string[] } | null {
  const separator = ref.indexOf(":");
  if (separator < 0) return null;
  const file = ref.slice(0, separator).trim();
  const labels = ref
    .slice(separator + 1)
    .split(/[、,，;；]/u)
    .map((label) => label.trim())
    .filter(Boolean);
  return file && labels.length > 0 ? { file, labels } : null;
}

/**
 * 按引用取小节。**取不到就跳过**，由调用方在阶段报告里如实说明——
 * 不退回"整份材料塞进去"这种偷懒做法。
 */
export function selectStandardSections(
  refs: readonly string[],
  sections: readonly StandardSection[],
): StandardSection[] {
  const picked: StandardSection[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = parseStandardRef(ref);
    if (!parsed) continue;
    const file = basename(parsed.file);
    for (const label of parsed.labels) {
      const inFile = sections.filter((section) => basename(section.file) === file);
      // 先按小节号**精确**匹配，再退回标题包含。
      // 只做标题包含会误命中：引用 `7` 会先撞上标题里含 7 的 `5.7`。
      const hit =
        inFile.find((section) => section.label === label) ??
        inFile.find((section) => section.title.includes(label));
      if (!hit) continue;
      const key = `${hit.file}#${hit.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(hit);
    }
  }
  return picked;
}

/**
 * 从工作区读判据材料。
 *
 * 目录不存在（老工作区还没装基线）时返回空数组——调用方据此如实报告
 * "判据材料未提供"，而不是假装查过。
 */
export async function loadStandardSections(
  files: readonly string[],
  root = join(knowledgeDir(), STANDARDS_DIR_NAME),
): Promise<StandardSection[]> {
  const sections: StandardSection[] = [];
  for (const file of [...new Set(files.map((item) => basename(item)))]) {
    let content: string;
    try {
      content = await readFile(join(root, file), "utf8");
    } catch {
      continue;
    }
    sections.push(...parseStandardSections(content, `references/${file}`));
  }
  return sections;
}

/**
 * 取不到具体小节时的兜底：给出**该材料的目录**（小节标题清单）。
 *
 * 实测标准里的引用不全是精确标题——`references/delivery-and-sources.md:视觉三轮`
 * 指的是那一节讲的内容，而不是某个标题。这种情况下把整份材料塞进去既浪费又抓不到重点，
 * 但**直接跳过又等于"没读标准"**（标准明确要求软件不能跳过对应章节）。
 * 折中：把该材料的目录给模型，让它知道去哪里找，并在阶段报告里说明未定位到小节。
 */
export function standardTableOfContents(
  refs: readonly string[],
  sections: readonly StandardSection[],
): Array<{ file: string; titles: string[] }> {
  const byFile = new Map<string, string[]>();
  for (const ref of refs) {
    // 判据就是"这条引用取不取得到小节"——与 Pipeline 取用时同一把尺子，不另立标准。
    if (selectStandardSections([ref], sections).length > 0) continue;
    const parsed = parseStandardRef(ref);
    if (!parsed) continue;
    const file = `references/${basename(parsed.file)}`;
    if (byFile.has(file)) continue;
    byFile.set(
      file,
      sections.filter((section) => section.file === file).map((section) => section.title),
    );
  }
  return [...byFile.entries()]
    .filter(([, titles]) => titles.length > 0)
    .map(([file, titles]) => ({ file, titles }));
}

/** 规则引用里涉及哪些判据文件（供读取时只读需要的几份）。 */
export function standardFilesOf(refs: readonly string[]): string[] {
  return [
    ...new Set(
      refs
        .map((ref) => parseStandardRef(ref)?.file)
        .filter((file): file is string => Boolean(file)),
    ),
  ];
}
