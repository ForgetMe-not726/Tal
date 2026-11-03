import { join } from "node:path";
import { NextResponse } from "next/server";
import { listCollectionManifests } from "@/lib/knowledge/collections";
import { listConfirmedSources, listJobViews } from "@/lib/ocr/jobs";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { listDir } from "@/lib/workspace/json";
import { knowledgeDir, libraryDir, ocrLibraryDir, recycleDir, workspaceRoot } from "@/lib/workspace/paths";
import { listLibraryItems, reconcileLibraryIndexes } from "@/lib/library/store";

export const runtime = "nodejs";

/**
 * 本地资料库概览：老师要能一眼看到「有哪些书、放在哪、怎么打开」。
 *
 * 这里只读列出资料；导入/移除在 `/api/library/items`，原始资料始终在本地目录。
 */
export async function GET() {
  try {
    await ensureWorkspace();
    await reconcileLibraryIndexes();
    const [sources, jobs, collections, grammarFiles, standardFiles, items] = await Promise.all([
      listConfirmedSources(),
      listJobViews(),
      listCollectionManifests(),
      listDir(join(knowledgeDir(), "grammar")),
      listDir(join(knowledgeDir(), "review-standards")),
      listLibraryItems(),
    ]);
    return NextResponse.json({
      workspace: workspaceRoot(),
      ocrDir: ocrLibraryDir(),
      knowledgeDir: knowledgeDir(),
      sources,
      confirmedCount: sources.length,
      pendingCount: jobs.filter((job) => job.manifest?.status !== "confirmed").length,
      collections,
      grammarCount: grammarFiles.filter((name) => name.endsWith(".md") && !/^readme\.md$/iu.test(name)).length,
      standardsCount: standardFiles.filter((name) => name.endsWith(".md") && !/^readme\.md$/iu.test(name)).length,
      libraryDir: libraryDir(),
      recycleDir: recycleDir(),
      library: {
        items,
        processingCount: items.filter((item) => item.state === "processing").length,
        needsOcrCount: items.filter((item) => item.state === "needs_ocr" || item.state === "partial").length,
      },
    });
  } catch (error) {
    console.error("[api/library] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
