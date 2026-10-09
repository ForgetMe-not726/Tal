import type { KnowledgeLayer } from "@/lib/db/types";
import type { RetrievedKnowledge } from "@/lib/knowledge/types";

const LAYER_PRIORITY: Record<KnowledgeLayer, number> = {
  production_source: 0,
  authoritative_standards: 1,
  reference_materials: 2,
};

function candidateSort(a: RetrievedKnowledge, b: RetrievedKnowledge) {
  return (
    LAYER_PRIORITY[a.entry.layer] - LAYER_PRIORITY[b.entry.layer] ||
    b.exactness - a.exactness ||
    a.entry.source_ref.localeCompare(b.entry.source_ref)
  );
}

export function selectKnowledgeCandidates(
  candidates: RetrievedKnowledge[],
  options: { maxEntries: number; maxChars: number },
) {
  const deduped = new Map<string, RetrievedKnowledge>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.entry.source_ref);
    if (!existing || candidate.exactness > existing.exactness) deduped.set(candidate.entry.source_ref, candidate);
  }
  const sorted = [...deduped.values()].sort(candidateSort);
  const selected: RetrievedKnowledge[] = [];
  let usedChars = 0;
  let omittedByBudget = 0;
  for (const candidate of sorted) {
    if (selected.length >= options.maxEntries) {
      omittedByBudget += 1;
      continue;
    }
    const size = candidate.entry.content.length;
    if (size > options.maxChars || (selected.length > 0 && usedChars + size > options.maxChars)) {
      omittedByBudget += 1;
      continue;
    }
    selected.push({ ...candidate, rank: selected.length + 1 });
    usedChars += size;
  }
  return { selected, omittedByBudget };
}
