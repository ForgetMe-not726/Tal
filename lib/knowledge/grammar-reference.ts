/**
 * 语法参考知识库的**取用**：按大纲里的语法写法取对应语法点。
 *
 * 知识库本体在 `resources/knowledge/grammar/`（随包分发，由
 * `scripts/build-grammar-reference.mjs` 生成）。这里只做两件事：
 * 把「大纲的写法」翻成语法点编号，再把那个文件取出来（按预算截断）。
 *
 * 两条纪律：
 * 1. **认不出就不猜**：大纲写法没映射到语法点、或知识库没装，一律返回 null，
 *    由调用方如实记进资料缺口——不退回"整库塞进去"这种偷懒做法。
 * 2. **只取本课那一个点**：语法参考是写教材时的对照材料，不是背景知识；
 *    把整库塞进 Prompt 只会挤掉真正要用的上下文。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { knowledgeDir } from "../workspace/paths.ts";

export const GRAMMAR_DIR_NAME = "grammar";

/** 默认预算：单个语法点一般 8–20 KB，超了按前缀截断并如实说明。 */
export const DEFAULT_GRAMMAR_BUDGET = 12000;

type GrammarIndex = {
  points?: Array<{ id?: unknown; topic?: unknown; file?: unknown; sources?: unknown }>;
  labels?: Record<string, unknown>;
};

export type GrammarReference = {
  pointId: string;
  topic: string;
  /** 命中的大纲写法（老师能看出"你这句被理解成了哪个语法点"）。 */
  label: string;
  /** 取到的正文。 */
  text: string;
  /** 来源与页码（书名 · 单元/章 · 页），供建议卡片与报告显示。 */
  sources: string[];
  /** 正文超预算被截断。 */
  truncated: boolean;
};

/**
 * 大纲里的语法写法 → 语法点编号。
 *
 * 按**子串**匹配：大纲里一个语法点常写成好几行
 * （「形容词、副词的比较级和最高级 / 同级比较：as...as / 修饰比较级的限定词：…」）。
 * 多个写法同时命中时取**最长**的那个，避免"比较级"把"同级比较"抢走。
 */
export function resolveGrammarLabel(
  labels: Record<string, string>,
  grammar: string | null | undefined,
): { id: string; label: string } | null {
  if (!grammar?.trim()) return null;
  const hits = Object.entries(labels)
    .filter(([label]) => grammar.includes(label))
    .sort((a, b) => b[0].length - a[0].length);
  const hit = hits[0];
  return hit ? { id: hit[1], label: hit[0] } : null;
}

/** 读知识库索引（随包基线，装在工作区 `knowledge/grammar/` 下）。 */
export async function readGrammarIndex(
  root = join(knowledgeDir(), GRAMMAR_DIR_NAME),
): Promise<GrammarIndex | null> {
  try {
    return JSON.parse(await readFile(join(root, "index.json"), "utf8")) as GrammarIndex;
  } catch {
    return null;
  }
}

/**
 * 取本课语法参考。取不到返回 null——调用方据此记缺口，不假装有。
 */
export async function loadGrammarReference(input: {
  grammar: string | null | undefined;
  maxChars?: number;
  root?: string;
}): Promise<GrammarReference | null> {
  const root = input.root ?? join(knowledgeDir(), GRAMMAR_DIR_NAME);
  const index = await readGrammarIndex(root);
  if (!index?.labels || !Array.isArray(index.points)) return null;

  const labels = Object.fromEntries(
    Object.entries(index.labels).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const resolved = resolveGrammarLabel(labels, input.grammar);
  if (!resolved) return null;

  const point = index.points.find((item) => item.id === resolved.id);
  if (!point || typeof point.file !== "string") return null;

  let raw: string;
  try {
    raw = await readFile(join(root, point.file), "utf8");
  } catch {
    return null;
  }

  const budget = Math.max(500, input.maxChars ?? DEFAULT_GRAMMAR_BUDGET);
  const truncated = raw.length > budget;
  return {
    pointId: resolved.id,
    topic: typeof point.topic === "string" ? point.topic : resolved.id,
    label: resolved.label,
    text: truncated ? `${raw.slice(0, budget)}\n\n（本课语法参考超出预算，已截断；完整内容见知识库 ${point.file}）` : raw,
    sources: Array.isArray(point.sources)
      ? point.sources.filter((item): item is string => typeof item === "string")
      : [],
    truncated,
  };
}

/**
 * 语法参考进生成 Prompt 的写法。**纯函数**，便于单测。
 *
 * 取不到时不是留空，而是明说"没有参考、以大纲为准"——留空会让模型拿自己的印象补语法规则，
 * 那正是这份知识库要防的事。
 */
export function renderGrammarBlock(reference: GrammarReference | null): string {
  if (!reference) return "（本课没有对应的语法参考：语法点以大纲为准，不要凭印象补写语法规则。）";
  return [
    `本课核心语法是「${reference.label}」，对应语法参考 ${reference.pointId} ${reference.topic}。`,
    `来源：${reference.sources.slice(0, 6).join("；")}`,
    "",
    reference.text,
  ].join("\n");
}
