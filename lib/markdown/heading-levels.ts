/**
 * 标题层级划定。
 *
 * 带编号的模块标题（`1. Let's say!`、`2. Let's read!`、`3. Let's talk!`）是**标题 1**，
 * 它们下设的小节（核心词汇、FCE 重难点派生词表、阅读词汇……）是**标题 2**。
 *
 * 不参与编号的模块（知识清单的「学习目标」、学生用书的主题页）不出现在大纲里。
 *
 * 编号**不在这里写死模块清单**——顺序与是否编号都来自模块目录
 * （`lib/modules/directory.ts`），由调用方传进来。这样换书种或换课型时，
 * 编号会跟着目录走（学生用书复习课没有 explore/read，say 就是 1）。
 */

/**
 * 某个模块在整课里的编号，从 1 开始；不参与编号的模块返回 null。
 *
 * `numberedKeys` 是**该课实际参与编号的模块顺序**，由调用方从目录取出。
 * 不按“已经生成了几个模块”计数——否则只生成 Let's talk! 会被编成 1，与教材结构对不上。
 */
export function moduleOrdinal(
  moduleKey: string | undefined,
  numberedKeys: readonly string[],
): number | null {
  if (!moduleKey) return null;
  const index = numberedKeys.indexOf(moduleKey);
  return index >= 0 ? index + 1 : null;
}

/** 模块标题的编号前缀，例如 `1. `；不编号时返回空串。 */
export function ordinalPrefix(ordinal: number | null): string {
  return ordinal ? `${ordinal}. ` : "";
}

/**
 * 把模块正文开头的标题规范成统一形式。
 *
 * - 带编号的模块 → 开头换成 `# 1. Let's say!`（标题 1），编号和文字在同一行、同一个标题里。
 * - 不编号的模块（学习目标）→ 去掉开头标题，它的标题并进表格首行（见 table-templates 的 objectives）。
 *
 * **只有第一个标题确实像模块标题时才替换**，否则插入一行模块标题。
 * 判据是「等于模块标题，或以它开头」——这样两种写法都对：
 * - 模型写 `## Let's talk! · 语法`（带上模块全名）→ 以 `Let's talk!` 开头 → 替换，正文里不会留重复标题；
 * - 模型直接从第一个小节写起（练习册的 `## Let's say!`、知识清单的 `### 核心词汇`）
 *   → 不以模块标题开头 → 插入模块标题，**小节标题不会被吃掉**。
 */
export function normalizeModuleHeading(markdown: string, heading: string | null): string {
  const lines = markdown.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return markdown;

  const match = /^#{1,6}\s+(.*)$/.exec(lines[index]);
  if (!heading) {
    // 不显示独立标题的模块（知识清单「学习目标」）：去掉开头那一行标题。
    if (match) lines.splice(index, 1);
    return lines.join("\n").replace(/^\n+/, "").trimEnd();
  }

  const normalized = `# ${heading}`;
  // 两侧都可能带「3. 」这样的序号前缀（我们传进来的带、模型写的通常不带），比较前统一剥掉。
  // 序号里的点可能是**转义过的**（`1\. Let's say!`）——富文本编辑区回写时 turndown 会加这个
  // 反斜杠，不认它就会把同一个标题重复插一遍。
  const stripOrdinal = (value: string) => value.trim().replace(/^\d+\\?\.\s*/u, "");
  const base = stripOrdinal(heading);
  const firstHeadingText = stripOrdinal(match?.[1] ?? "");
  const looksLikeModuleTitle =
    firstHeadingText.length > 0 && base.length > 0 && firstHeadingText.startsWith(base);

  if (match && looksLikeModuleTitle) lines.splice(index, 1, normalized);
  else lines.splice(index, 0, normalized, "");
  return lines.join("\n").replace(/^\n+/, "").trimEnd();
}

/**
 * 把模块内的小节标题压成从 `##` 开始的连续层级。
 *
 * 为什么需要：模块标题由 `normalizeModuleHeading` 统一成 `#`，但模型写小节时深浅不一——
 * 知识清单写 `### 核心词汇`，练习册写 `## Let's say!` + `### 1 Match...`。
 * 直接按绝对层级映射到 Word 标题，同一本书里会出现大小不一致。
 *
 * 这里改成**按相对深度**：第一个小节恒为 `##`，更深的依次 `###`、`####`。
 * 于是知识清单的 `###` 与练习册的 `##` 都落到同一级，练习册的 `###` 落到下一级。
 */
export function normalizeHeadingDepths(markdown: string): string {
  const lines = markdown.split("\n");
  const headingIndexes: number[] = [];
  const levels: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+/.exec(lines[i]);
    if (!match) continue;
    headingIndexes.push(i);
    levels.push(match[1].length);
  }
  // 第一个标题是模块标题，不参与重排。
  const rest = levels.slice(1);
  if (rest.length === 0) return markdown;
  const shallowest = Math.min(...rest);
  const shift = 2 - shallowest;
  if (shift === 0) return markdown;

  for (let i = 1; i < headingIndexes.length; i += 1) {
    const lineIndex = headingIndexes[i];
    const text = lines[lineIndex].replace(/^#{1,6}\s+/, "");
    const next = Math.min(6, Math.max(2, levels[i] + shift));
    lines[lineIndex] = `${"#".repeat(next)} ${text}`;
  }
  return lines.join("\n");
}
