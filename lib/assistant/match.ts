/**
 * 检索的**匹配与排序**：纯函数，不碰工作区。
 *
 * 与"读工作区"分开（后者在 `local-search.ts`），这样匹配逻辑能被 node 直接单测——
 * 它决定"结果里有什么、按什么排"，是最容易悄悄错的地方。
 */

import type { KnowledgeEntryRow } from "@/lib/db/types";
import type { AssistantHit, AssistantQuery, AssistantResult, AssistantSearched, AssistantSourceKind } from "./types.ts";

const DEFAULT_LIMIT = 12;
/** 片段前后各留多少字符的上下文。 */
const SNIPPET_PAD = 90;
const SNIPPET_MAX = 320;

/**
 * 分数 = 命中处数（**封顶**）+ 标题命中加成。
 *
 * 封顶是必须的：原始出现次数奖励的是"文档大"，不是"相关"。实测不封顶时，
 * 搜「反义疑问句」会把内容最长的 GR01 排到真正对的 GR11 前面。
 */
const COUNT_CAP = 5;

/**
 * 同分时的类别次序：**教材内容优先，规则最后**。
 *
 * 不这么排的话，同分只能按字母序——`reference` 恰好排在 `source` 前面，
 * 于是"某模块里包含某词"这类问题会被一堆语法参考书压下去。
 * 这是排序偏好，不是权威性排序（权威性由命中本身与来源状态表达）。
 */
const KIND_PRIORITY: Record<AssistantSourceKind, number> = {
  source: 0,
  exemplar: 1,
  version: 2,
  reference: 3,
  rule: 4,
};

function normalize(text: string): string {
  return text.replace(/\s+/gu, " ").toLocaleLowerCase();
}

/** 标题/文档名命中任一关键词的加成。 */
function titleBonus(title: string, keywords: readonly string[]): number {
  const normalized = normalize(title);
  return keywords.some((keyword) => normalized.includes(keyword)) ? 4 : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 关键词匹配模式。
 *
 * **英文词要卡词边界**，中文不用（中文没空格，子串就是对的）。实测不卡边界的后果：
 * 搜「反义疑问句」（模型会带上 question / tag）时，`tag` 会命中 cottage、stage、advantage，
 * 把一堆无关的语法文件排到前面。
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = escapeRegExp(keyword);
  const ascii = /^[\x20-\x7e]+$/u.test(keyword);
  return new RegExp(ascii ? `\\b${escaped}\\b` : escaped, "giu");
}

/** 命中的**页**：正文里保留了 `<!-- page N -->` 标记，按标记往下数即可。 */
function firstMatchPage(text: string, keywords: readonly string[]): number | null {
  let page = null;
  for (const line of text.split("\n")) {
    const marker = /^<!-- page (\d+) -->$/u.exec(line.trim());
    if (marker) {
      page = Number(marker[1]);
      continue;
    }
    if (page != null && keywords.some((keyword) => keywordPattern(keyword).test(line))) return page;
  }
  return page;
}

/** 命中片段：取第一次命中的位置前后加一点上下文。 */
function snippetOf(text: string, keywords: readonly string[]): { snippet: string; count: number; first: number } | null {
  const haystack = normalize(text);
  let count = 0;
  let first = -1;
  for (const keyword of keywords) {
    for (const match of haystack.matchAll(keywordPattern(keyword))) {
      count += 1;
      if (first < 0 || match.index < first) first = match.index;
    }
  }
  if (count === 0 || first < 0) return null;
  const start = Math.max(0, first - SNIPPET_PAD);
  const raw = text.slice(start, start + SNIPPET_MAX).trim();
  return { snippet: (start > 0 ? "…" : "") + raw + (start + SNIPPET_MAX < text.length ? "…" : ""), count, first };
}

/** 从条目 payload 里读来源定位（写入口在 `lib/knowledge/repository.ts` 的 sourcePayload）。 */
export function entryLocation(entry: KnowledgeEntryRow) {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const document = typeof payload.source_document === "string" ? payload.source_document : "";
  const page = typeof payload.page === "number" ? payload.page : null;
  const status = payload.source_status === "confirmed" ? "confirmed" : "pending";
  return { document, page, status } as const;
}

/** 已收集好的语料。字段刻意用结构类型，纯函数不依赖 store 的完整行类型。 */
export type SearchCorpora = {
  projects: Array<{ id: string }>;
  lessons: Array<{ projectId: string; lesson: { id: string; lesson_number: number } }>;
  entries: KnowledgeEntryRow[];
  rules: Array<{ ruleKey: string; displayName: string; description: string; instruction: string; scope: string }>;
  versions: Array<{
    bookType: string;
    moduleKey: string;
    moduleLabel: string;
    versionNumber: number;
    lessonNumber: number | null;
    markdown: string;
  }>;
  references: Array<{ name: string; text: string }>;
  /** 范本教材（知识库集合按模块切好的正文，带 `<!-- page N -->` 标记）。 */
  collectionDocs?: Array<{
    collectionId: string;
    collectionTitle: string;
    bookType: string;
    lessonNumber: number;
    lessonTitle: string;
    moduleKey: string;
    pages: [number, number] | null;
    text: string;
  }>;
  /** 集合里一共有多少个模块（用于如实说明截断）。 */
  collectionTotal?: number;
};

/** 在已收集的语料上做字面检索。**纯函数**，便于单测。 */
export function searchCorpora(
  corpora: SearchCorpora,
  query: AssistantQuery,
  options: { ocrByProject?: Map<string, Map<string, string>> } = {},
): AssistantResult {
  const keywords = [
    ...new Set(normalize(query.query).split(/[\s,，、;；]+/u).filter((word) => word.length >= 2)),
  ];
  const limit = Math.max(1, query.limit ?? DEFAULT_LIMIT);
  const hits: AssistantHit[] = [];

  // 条目的行里只有 lesson_id，页码筛选要把它翻成 Lesson 编号
  const lessonNumberById = new Map(corpora.lessons.map((item) => [item.lesson.id, item.lesson.lesson_number]));

  const kindAllowed = (kind: AssistantSourceKind) => !query.sourceKind || query.sourceKind === kind;
  const lessonAllowed = (lessonNumber: number | null) =>
    query.lessonNumber == null || lessonNumber === query.lessonNumber;
  const bookAllowed = (bookType: string | null) => !query.bookType || bookType === query.bookType;
  const moduleAllowed = (moduleKey: string | null) => !query.moduleKey || moduleKey === query.moduleKey;

  if (keywords.length > 0) {
    if (kindAllowed("source")) {
      for (const entry of corpora.entries) {
        const location = entryLocation(entry);
        if (!bookAllowed(entry.book_type)) continue;
        if (!moduleAllowed(entry.module_key)) continue;
        const entryLesson = entry.lesson_id ? lessonNumberById.get(entry.lesson_id) ?? null : null;
        if (!lessonAllowed(entryLesson)) continue;
        const matched = snippetOf(`${entry.title}\n${entry.content}`, keywords);
        if (!matched) continue;
        const jobId =
          location.document && entry.project_id
            ? options.ocrByProject?.get(entry.project_id)?.get(location.document) ?? null
            : null;
        hits.push({
          kind: "source",
          snippet: matched.snippet,
          sourceRef: entry.source_ref,
          documentName: location.document || entry.title,
          bookType: entry.book_type,
          lessonNumber: entryLesson,
          moduleKey: entry.module_key,
          pageIndex: location.page == null ? null : Math.max(0, location.page - 1),
          blockId: null,
          box: null,
          status: location.status,
          ocrJobId: jobId,
          score: Math.min(matched.count, COUNT_CAP) + titleBonus(entry.title, keywords),
        });
      }
    }

    if (kindAllowed("rule")) {
      for (const rule of corpora.rules) {
        const matched = snippetOf(`${rule.displayName}\n${rule.description}\n${rule.instruction}`, keywords);
        if (!matched) continue;
        hits.push({
          kind: "rule",
          snippet: matched.snippet,
          sourceRef: `rule:${rule.ruleKey}`,
          documentName: `${rule.ruleKey} ${rule.displayName}`,
          bookType: null,
          lessonNumber: null,
          moduleKey: null,
          pageIndex: null,
          blockId: null,
          box: null,
          status: "confirmed",
          ocrJobId: null,
          score: Math.min(matched.count, COUNT_CAP) + titleBonus(rule.displayName, keywords),
        });
      }
    }

    if (kindAllowed("version")) {
      for (const version of corpora.versions) {
        if (!bookAllowed(version.bookType)) continue;
        if (!moduleAllowed(version.moduleKey)) continue;
        if (!lessonAllowed(version.lessonNumber)) continue;
        const matched = snippetOf(version.markdown, keywords);
        if (!matched) continue;
        hits.push({
          kind: "version",
          snippet: matched.snippet,
          sourceRef: `version:${version.bookType}/${version.moduleKey}#${version.versionNumber}`,
          documentName: `${version.moduleLabel}（v${version.versionNumber}）`,
          bookType: version.bookType,
          lessonNumber: version.lessonNumber,
          moduleKey: version.moduleKey,
          pageIndex: null,
          blockId: null,
          box: null,
          status: "confirmed",
          ocrJobId: null,
          score: Math.min(matched.count, COUNT_CAP) + titleBonus(version.moduleLabel, keywords),
        });
      }
    }

    if (kindAllowed("reference")) {
      for (const reference of corpora.references) {
        const matched = snippetOf(reference.text, keywords);
        if (!matched) continue;
        hits.push({
          kind: "reference",
          snippet: matched.snippet,
          sourceRef: `reference:${reference.name}`,
          documentName: reference.name,
          bookType: null,
          lessonNumber: null,
          moduleKey: null,
          pageIndex: null,
          blockId: null,
          box: null,
          status: "confirmed",
          ocrJobId: null,
          score: Math.min(matched.count, COUNT_CAP) + titleBonus(reference.name, keywords),
        });
      }
    }
  }

    if (kindAllowed("exemplar")) {
      for (const doc of corpora.collectionDocs ?? []) {
        if (!bookAllowed(doc.bookType)) continue;
        if (!moduleAllowed(doc.moduleKey)) continue;
        if (!lessonAllowed(doc.lessonNumber)) continue;
        const matched = snippetOf(doc.text, keywords);
        if (!matched) continue;
        const page = firstMatchPage(doc.text, keywords);
        hits.push({
          kind: "exemplar",
          snippet: matched.snippet,
          sourceRef: `collection:${doc.collectionId}/${doc.bookType}/lesson-${String(doc.lessonNumber).padStart(2, "0")}/${doc.moduleKey}`,
          documentName: `${doc.collectionTitle} · ${doc.moduleKey}`,
          bookType: doc.bookType,
          lessonNumber: doc.lessonNumber,
          moduleKey: doc.moduleKey,
          pageIndex: page,
          blockId: null,
          box: null,
          status: "confirmed",
          ocrJobId: null,
          ...(page == null
            ? {}
            : {
                pageImageUrl: `/api/knowledge/collections/${encodeURIComponent(doc.collectionId)}/ocr/${doc.bookType}/pages/p${String(page).padStart(4, "0")}.jpg`,
              }),
          score: Math.min(matched.count, COUNT_CAP) + titleBonus(`${doc.moduleKey} ${doc.collectionTitle}`, keywords),
        });
      }
    }

  const searched: AssistantSearched = {
    scope: query.scope,
    projects: corpora.projects.length,
    lessons: corpora.lessons.length,
    entries: corpora.entries.length,
    rules: corpora.rules.length,
    versions: corpora.versions.length,
    references: corpora.references.length,
    exemplars: (corpora.collectionDocs ?? []).length,
    keywords,
  };

  // 排序：分数只是提示（§4）；同分按类别与引用稳定排序，保证同一查询每次结果一致
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      a.sourceRef.localeCompare(b.sourceRef),
  );
  return { hits: hits.slice(0, limit), searched, gaps: [] };
}
