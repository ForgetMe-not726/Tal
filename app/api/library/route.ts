import { join } from "node:path";
import { NextResponse } from "next/server";
import { listCollectionManifests } from "@/lib/knowledge/collections";
import { listConfirmedSources, listJobViews } from "@/lib/ocr/jobs";
import { ensureWorkspace } from "@/lib/workspace/bootstrap";
import { listDir } from "@/lib/workspace/json";
import { knowledgeDir, ocrLibraryDir, workspaceRoot } from "@/lib/workspace/paths";

export const runtime = "nodejs";

/**
 * 本地资料库概览：老师要能一眼看到「有哪些书、放在哪、怎么打开」。
 *
 * 只读：这里不提供删除或改写，识别结果和参考资料仍由识别页 / 安装包维护。
 */
export async function GET() {
  try {
    await ensureWorkspace();
    const [sources, jobs, collections, grammarFiles, standardFiles] = await Promise.all([
      listConfirmedSources(),
      listJobViews(),
      listCollectionManifests(),
      listDir(join(knowledgeDir(), "grammar")),
      listDir(join(knowledgeDir(), "review-standards")),
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
    });
  } catch (error) {
    console.error("[api/library] GET failed:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
