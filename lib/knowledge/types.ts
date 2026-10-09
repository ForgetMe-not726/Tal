import type {
  BookType,
  Grade,
  KnowledgeEntryRow,
  KnowledgeLayer,
  ModuleDefinitionRow,
  ModuleMappingRow,
  SourceModuleRow,
} from "@/lib/db/types";

export type SourceReviewStatus = "pending" | "confirmed";
export type SourceVerificationMode = "manual_confirmation" | "verified_ocr_import" | "verified_outline_import";

export type SourceImportInput = {
  projectId?: string;
  projectName?: string;
  grade: Grade;
  term: string;
  lessonId?: string;
  lessonNumber: number;
  lessonTitle: string;
  sourceBookType: BookType;
  targetBookType?: BookType;
  moduleKey: string;
  moduleLabel: string;
  sourceModuleTitle?: string;
  rawText?: string;
  confirmedText?: string;
  sourceDocument?: string;
  page?: number;
  notes?: string;
  status: SourceReviewStatus;
  verificationMode?: SourceVerificationMode;
  targetModuleIds?: string[];
  mappingType?: string;
  mappingPriority?: number;
  /**
   * 知识分层。旧版公司教材是 production_source（默认）；
   * 剑桥官方大纲/CEFR 属 authoritative_standards；真题、教辅属 reference_materials。
   * 不显式指定时按 production_source 处理，保持既有导入行为不变。
   */
  layer?: KnowledgeLayer;
};

export type SourceImportResult = {
  projectId: string;
  lessonId: string;
  sourceModule: SourceModuleRow;
  entry: KnowledgeEntryRow;
  mappings: ModuleMappingRow[];
  deduplicated: boolean;
};

export type KnowledgeQuery = {
  projectId: string;
  lessonId: string;
  grade: Grade;
  bookType: BookType;
  sourceBookType: BookType;
  targetModuleKey: string;
  targetModuleLabel?: string;
  maxEntries?: number;
  maxChars?: number;
  allowSemanticFallback?: boolean;
};

export type RetrievalReason = "mapped_source" | "exact_module" | "lesson_source" | "semantic_candidate";

export type RetrievedKnowledge = {
  entry: KnowledgeEntryRow;
  sourceModule: SourceModuleRow | null;
  mapping: ModuleMappingRow | null;
  targetDefinition: ModuleDefinitionRow | null;
  reason: RetrievalReason;
  rank: number;
  exactness: number;
};

export type RetrievalTrace = {
  strategy: "structured_hybrid";
  query: Omit<KnowledgeQuery, "targetModuleLabel">;
  structuredCandidates: number;
  semanticCandidates: number;
  selected: Array<{
    sourceRef: string;
    sourceModuleId: string | null;
    layer: KnowledgeEntryRow["layer"];
    reason: RetrievalReason;
    exactness: number;
  }>;
  omittedUnconfirmed: number;
  omittedByBudget: number;
};

export interface EmbeddingProvider {
  readonly name: string;
  search(input: {
    query: string;
    projectId: string;
    lessonId: string;
    sourceBookType: BookType;
    limit: number;
  }): Promise<KnowledgeEntryRow[]>;
}

export type KnowledgeContext = {
  sourceText: string;
  sourceRefs: string[];
  trace: RetrievalTrace;
  entries: RetrievedKnowledge[];
};
