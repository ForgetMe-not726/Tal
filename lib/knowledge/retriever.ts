import { getAppStore } from "@/lib/db/store";
import type { KnowledgeEntryRow, ModuleDefinitionRow, ModuleMappingRow, SourceModuleRow } from "@/lib/db/types";
import type {
  EmbeddingProvider,
  KnowledgeQuery,
  RetrievedKnowledge,
  RetrievalTrace,
  RetrievalReason,
} from "@/lib/knowledge/types";
import { selectKnowledgeCandidates } from "@/lib/knowledge/retrieval-core";

const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = {
  name: "noop",
  async search() {
    return [];
  },
};

export type RetrievalResult = {
  entries: RetrievedKnowledge[];
  trace: RetrievalTrace;
};

function makeCandidate(
  entry: KnowledgeEntryRow,
  sourceModule: SourceModuleRow | null,
  mapping: ModuleMappingRow | null,
  targetDefinition: ModuleDefinitionRow | null,
  reason: RetrievalReason,
  exactness: number,
): RetrievedKnowledge {
  return { entry, sourceModule, mapping, targetDefinition, reason, exactness, rank: 0 };
}

export async function retrieveKnowledge(
  query: KnowledgeQuery,
  embeddingProvider: EmbeddingProvider = DEFAULT_EMBEDDING_PROVIDER,
): Promise<RetrievalResult> {
  const store = getAppStore();
  const maxEntries = Math.max(1, query.maxEntries ?? 24);
  const maxChars = Math.max(1000, query.maxChars ?? 24000);
  const [targetDefinitions, sourceModules, allEntries, confirmedEntriesRaw] = await Promise.all([
    store.listModuleDefinitions(query.bookType),
    store.listSourceModules({
      projectId: query.projectId,
      lessonId: query.lessonId,
      bookType: query.sourceBookType,
      status: "confirmed",
    }),
    store.listKnowledgeEntries({
      projectId: query.projectId,
      grade: query.grade,
      lessonId: query.lessonId,
      bookType: query.sourceBookType,
    }),
    store.listKnowledgeEntries({
      projectId: query.projectId,
      grade: query.grade,
      lessonId: query.lessonId,
      bookType: query.sourceBookType,
      confirmedOnly: true,
    }),
  ]);

  const confirmedSourceIds = new Set(sourceModules.map((source) => source.id));
  // An entry linked to a source module is usable only when both the entry and
  // its structural anchor are confirmed. Legacy entries without an anchor are
  // allowed unless they explicitly carry source_status=pending.
  const confirmedEntries = confirmedEntriesRaw.filter(
    (entry) => !entry.source_module_id || confirmedSourceIds.has(entry.source_module_id),
  );
  const targetDefinition = targetDefinitions.find((item) => item.module_key === query.targetModuleKey) ?? null;
  const sourceById = new Map(sourceModules.map((source) => [source.id, source]));
  const entryBySourceId = new Map<string, KnowledgeEntryRow[]>();
  for (const entry of confirmedEntries) {
    if (!entry.source_module_id) continue;
    const list = entryBySourceId.get(entry.source_module_id) ?? [];
    list.push(entry);
    entryBySourceId.set(entry.source_module_id, list);
  }

  const mappedSourceIds = new Set<string>();
  const mappingBySourceId = new Map<string, ModuleMappingRow>();
  let mappings: ModuleMappingRow[] = [];
  if (targetDefinition) {
    mappings = await store.listModuleMappings({
      projectId: query.projectId,
      targetModuleId: targetDefinition.id,
      sourceModuleIds: sourceModules.map((source) => source.id),
    });
    for (const mapping of mappings) {
      mappedSourceIds.add(mapping.source_module_id);
      mappingBySourceId.set(mapping.source_module_id, mapping);
    }
  }

  const candidates: RetrievedKnowledge[] = [];
  for (const sourceId of mappedSourceIds) {
    const source = sourceById.get(sourceId) ?? null;
    for (const entry of entryBySourceId.get(sourceId) ?? []) {
      candidates.push(makeCandidate(entry, source, mappingBySourceId.get(sourceId) ?? null, targetDefinition, "mapped_source", 1));
    }
  }

  for (const entry of confirmedEntries) {
    if (entry.source_module_id && mappedSourceIds.has(entry.source_module_id)) continue;
    if (entry.module_key !== query.targetModuleKey) continue;
    const source = entry.source_module_id ? sourceById.get(entry.source_module_id) ?? null : null;
    candidates.push(makeCandidate(entry, source, null, targetDefinition, "exact_module", 0.9));
  }

  for (const entry of confirmedEntries) {
    if (entry.source_module_id && mappedSourceIds.has(entry.source_module_id)) continue;
    if (entry.module_key === query.targetModuleKey) continue;
    const source = entry.source_module_id ? sourceById.get(entry.source_module_id) ?? null : null;
    candidates.push(makeCandidate(entry, source, null, targetDefinition, "lesson_source", 0.55));
  }

  const structuredCandidateCount = candidates.length;
  let semanticCandidates: KnowledgeEntryRow[] = [];
  let acceptedSemanticCount = 0;
  if (query.allowSemanticFallback) {
    semanticCandidates = await embeddingProvider.search({
      query: `${query.targetModuleKey} ${query.targetModuleLabel ?? ""}`.trim(),
      projectId: query.projectId,
      lessonId: query.lessonId,
      sourceBookType: query.sourceBookType,
      limit: Math.min(maxEntries, 8),
    });
    const confirmedRefs = new Set(confirmedEntries.map((entry) => entry.source_ref));
    for (const entry of semanticCandidates) {
      if (!confirmedRefs.has(entry.source_ref)) continue;
      if (entry.source_module_id && !sourceById.has(entry.source_module_id)) continue;
      const source = entry.source_module_id ? sourceById.get(entry.source_module_id) ?? null : null;
      candidates.push(makeCandidate(entry, source, null, targetDefinition, "semantic_candidate", 0.3));
      acceptedSemanticCount += 1;
    }
  }

  const selection = selectKnowledgeCandidates(candidates, { maxEntries, maxChars });
  const selected = selection.selected;
  const trace: RetrievalTrace = {
    strategy: "structured_hybrid",
    query: {
      projectId: query.projectId,
      lessonId: query.lessonId,
      grade: query.grade,
      bookType: query.bookType,
      sourceBookType: query.sourceBookType,
      targetModuleKey: query.targetModuleKey,
      maxEntries,
      maxChars,
      allowSemanticFallback: Boolean(query.allowSemanticFallback),
    },
    structuredCandidates: structuredCandidateCount,
    semanticCandidates: acceptedSemanticCount,
    selected: selected.map((candidate) => ({
      sourceRef: candidate.entry.source_ref,
      sourceModuleId: candidate.entry.source_module_id,
      layer: candidate.entry.layer,
      reason: candidate.reason,
      exactness: candidate.exactness,
    })),
    omittedUnconfirmed: Math.max(0, allEntries.length - confirmedEntries.length),
    omittedByBudget: selection.omittedByBudget,
  };

  return { entries: selected, trace };
}

export { DEFAULT_EMBEDDING_PROVIDER };
