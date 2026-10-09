"use client";

import * as React from "react";
import { RecognizeContent } from "@/components/recognize/RecognizeContent";
import { RecognizeLeftPanel, jobStatusOf, type ProjectOption } from "@/components/recognize/RecognizeLeftPanel";
import { RecognizePreview } from "@/components/recognize/RecognizePreview";
import { splitLegacyMarkdown } from "@/lib/knowledge/legacy-source";
import type { LegacyLessonPackage } from "@/lib/knowledge/legacy-markdown";
import type { OcrPage, OcrStructure } from "@/lib/ocr/types";
import type { OcrJobView } from "@/lib/ocr/jobs";
import type { BookTypeId } from "@/lib/types";

type JobDetail = { job: OcrJobView };

/**
 * 结构（页、块、低置信清单）**单独取一次**，不跟着轮询走。
 *
 * 轮询只拿状态与进度；结构 JSON 在 131 页的书上有几百 KB，每次轮询都传一遍是浪费。
 * 结构对应的是**未经老师编辑的识别结果**，所以取一次就够。
 */

/** 轮询间隔：识别动辄几分钟，3 秒够用又不吵。 */
const POLL_MS = 3000;

export default function RecognizePage() {
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [bookType, setBookType] = React.useState<BookTypeId>("knowledge");
  const [jobs, setJobs] = React.useState<OcrJobView[]>([]);
  const [engine, setEngine] = React.useState<{ ready: boolean; reason?: string }>({ ready: false });
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<JobDetail | null>(null);
  const [structure, setStructure] = React.useState<OcrStructure | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [savedMarkdown, setSavedMarkdown] = React.useState("");
  const [pageIndex, setPageIndex] = React.useState(0);
  const [activeBlockId, setActiveBlockId] = React.useState<string | null>(null);
  const [focusText, setFocusText] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const requestEpoch = React.useRef(0);
  /** 已经加载过正文与结构的任务；轮询不会重复拉。 */
  const loadedJobId = React.useRef<string | null>(null);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const status = selectedJob ? jobStatusOf(selectedJob) : "queued";
  const dirty = markdown !== savedMarkdown;
  const warnings = selectedJob?.manifest?.warnings ?? [];
  const lowConfidence = structure?.lowConfidence ?? [];

  /** 切分核对：用与制作页**同一条**解析路径，不新增第二条。 */
  const packages = React.useMemo<LegacyLessonPackage[]>(() => {
    if (!markdown.trim()) return [];
    try {
      return splitLegacyMarkdown(markdown, bookType);
    } catch {
      return [];
    }
  }, [markdown, bookType]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  // 项目列表
  React.useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { projects?: ProjectOption[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "项目列表加载失败");
        if (!active) return;
        const list = data.projects ?? [];
        setProjects(list);
        setProjectId((current) => current || list[0]?.id || "");
      })
      .catch((error: unknown) => active && setToast((error as Error).message));
    return () => {
      active = false;
    };
  }, []);

  const loadJobs = React.useCallback(
    async (targetProject: string, epoch: number) => {
      const response = await fetch(`/api/ocr?projectId=${encodeURIComponent(targetProject)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        jobs?: OcrJobView[];
        engine?: { ready: boolean; reason?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "任务列表加载失败");
      if (epoch !== requestEpoch.current) return;
      setJobs(data.jobs ?? []);
      if (data.engine) setEngine(data.engine);
    },
    [],
  );

  // 任务列表：切换项目时重载，并在有任务在跑时轮询
  React.useEffect(() => {
    if (!projectId) return;
    const epoch = requestEpoch.current;
    void loadJobs(projectId, epoch).catch((error: unknown) =>
      setToast((error as Error).message),
    );
  }, [projectId, loadJobs]);

  const anyRunning = jobs.some((job) =>
    ["queued", "running", "normalizing"].includes(job.status),
  );
  React.useEffect(() => {
    if (!projectId || !anyRunning) return;
    const epoch = requestEpoch.current;
    const timer = setInterval(() => {
      void loadJobs(projectId, epoch).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, anyRunning, loadJobs]);

  /** 选中任务：拉状态 + 结构 + 正文。 */
  const loadDetail = React.useCallback(
    async (jobId: string, epoch: number) => {
      const response = await fetch(`/api/ocr/${jobId}`, { cache: "no-store" });
      const data = (await response.json()) as { job?: OcrJobView; error?: string };
      if (!response.ok) throw new Error(data.error ?? "任务加载失败");
      if (epoch !== requestEpoch.current) return;
      setDetail({ job: data.job! });

      // 正文与结构只在**切换任务**时拉一次，避免轮询把老师的编辑冲掉
      if (loadedJobId.current === jobId) return;
      loadedJobId.current = jobId;
      const [text, structureResponse] = await Promise.all([
        fetch(`/api/ocr/${jobId}/raw/content.md`, { cache: "no-store" }),
        fetch(`/api/ocr/${jobId}/raw/structure.json`, { cache: "no-store" }),
      ]);
      if (epoch !== requestEpoch.current) return;
      if (text.ok) {
        const content = await text.text();
        setMarkdown(content);
        setSavedMarkdown(content);
      }
      if (structureResponse.ok) {
        setStructure((await structureResponse.json()) as OcrStructure);
      }
      setPageIndex(0);
      setActiveBlockId(null);
    },
    [],
  );

  React.useEffect(() => {
    if (!selectedJobId) return;
    const epoch = requestEpoch.current;
    void loadDetail(selectedJobId, epoch).catch((error: unknown) =>
      setToast((error as Error).message),
    );
  }, [selectedJobId, loadDetail]);

  // 有产物且正在跑时也刷新详情（进度、状态）
  React.useEffect(() => {
    if (!selectedJobId || !anyRunning) return;
    const epoch = requestEpoch.current;
    const timer = setInterval(() => {
      void loadDetail(selectedJobId, epoch).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [selectedJobId, anyRunning, loadDetail]);

  async function handleCreateProject(input: { name: string; grade: string; term: string }) {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as { project?: ProjectOption; error?: string };
      if (!response.ok) throw new Error(data.error ?? "新建项目失败");
      setProjects((previous) => [data.project!, ...previous.filter((item) => item.id !== data.project!.id)]);
      setProjectId(data.project!.id);
      setToast(`已新建项目「${data.project!.name}」`);
    } catch (error) {
      setToast((error as Error).message);
    }
  }

  /** 上传原件：**流式**发送，不走 multipart（教材 PDF 实测 209 MB）。 */
  async function handleUploadFile(file: File) {
    if (!projectId) {
      setToast("请先选择或新建项目");
      return;
    }
    setUploading(true);
    try {
      const query = new URLSearchParams({
        projectId,
        bookType,
        fileName: file.name,
      });
      const response = await fetch(`/api/ocr?${query.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      const data = (await response.json()) as { job?: OcrJobView; error?: string };
      if (!response.ok) throw new Error(data.error ?? "导入失败");
      setToast(`已开始识别「${file.name}」`);
      setSelectedJobId(data.job!.id);
      await loadJobs(projectId, requestEpoch.current);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleImportUpstream(upstreamDir: string) {
    if (!projectId) {
      setToast("请先选择或新建项目");
      return;
    }
    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, bookType, upstreamDir }),
      });
      const data = (await response.json()) as { job?: OcrJobView; error?: string };
      if (!response.ok) throw new Error(data.error ?? "导入失败");
      setToast("已导入已有产物，正在整理");
      setSelectedJobId(data.job!.id);
      await loadJobs(projectId, requestEpoch.current);
    } catch (error) {
      setToast((error as Error).message);
    }
  }

  async function handleSave() {
    if (!selectedJobId || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ocr/${selectedJobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      setSavedMarkdown(markdown);
      setToast("已保存修订");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!selectedJobId || confirming) return;
    setConfirming(true);
    try {
      const response = await fetch(`/api/ocr/${selectedJobId}/confirm`, { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "确认失败");
      setToast("已确认并加入资料库");
      await loadJobs(projectId, requestEpoch.current);
      await loadDetail(selectedJobId, requestEpoch.current);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  async function handleRetry() {
    if (!selectedJobId) return;
    try {
      const response = await fetch(`/api/ocr/${selectedJobId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "重新识别失败");
      setToast("已重新开始识别");
      await loadJobs(projectId, requestEpoch.current);
    } catch (error) {
      setToast((error as Error).message);
    }
  }

  const blocks = structure?.blocks ?? [];
  const page: OcrPage | null = structure?.pages.find((item) => item.index === pageIndex) ?? null;

  return (
    <div className="flex h-screen min-w-0 flex-1">
      <RecognizeLeftPanel
        projects={projects}
        projectId={projectId}
        onProjectChange={(next) => {
          requestEpoch.current += 1;
          loadedJobId.current = null;
          setProjectId(next);
          setSelectedJobId(null);
          setDetail(null);
          setStructure(null);
          setMarkdown("");
          setSavedMarkdown("");
        }}
        onCreateProject={(input) => void handleCreateProject(input)}
        bookType={bookType}
        onBookTypeChange={setBookType}
        jobs={jobs}
        selectedJobId={selectedJobId}
        onSelectJob={(jobId) => {
          if (jobId === selectedJobId) return;
          loadedJobId.current = null;
          setSelectedJobId(jobId);
          setDetail(null);
          setStructure(null);
          setMarkdown("");
          setSavedMarkdown("");
        }}
        uploading={uploading}
        onUploadFile={(file) => void handleUploadFile(file)}
        onImportUpstream={(dir) => void handleImportUpstream(dir)}
        engineReady={engine.ready}
        engineReason={engine.reason}
        pageCount={structure?.pageCount ?? 0}
        pageIndex={pageIndex}
        onSelectPage={(index) => {
          setPageIndex(index);
          setActiveBlockId(null);
        }}
        jobId={structure ? selectedJobId : null}
      />

      <RecognizePreview
        jobId={selectedJobId ?? ""}
        page={page}
        blocks={blocks}
        activeBlockId={activeBlockId}
        onSelectBlock={(blockId) => {
          setActiveBlockId(blockId);
          const block = blocks.find((item) => item.id === blockId);
          if (block?.text) setFocusText(block.text);
        }}
        lowConfidence={lowConfidence}
      />

      {selectedJobId && detail ? (
        <RecognizeContent
          status={status}
          pageIndex={pageIndex}
          blocks={blocks}
          lowConfidence={lowConfidence}
          markdown={markdown}
          onMarkdownChange={setMarkdown}
          focusText={focusText}
          onFocusConsumed={() => setFocusText(null)}
          dirty={dirty}
          saving={saving}
          confirming={confirming}
          onSave={() => void handleSave()}
          onConfirm={() => void handleConfirm()}
          onRetry={() => void handleRetry()}
          packages={packages}
          warnings={warnings}
        />
      ) : (
        <div className="flex h-full w-[440px] shrink-0 items-center justify-center border-l border-line bg-paper px-6">
          <p className="text-center text-xs leading-relaxed text-ink-3">
            选一个识别任务，或导入一份教材 PDF。
            <br />
            识别完成后在这里核对正文、切分与来源。
          </p>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-chrome px-4 py-2 text-sm text-paper shadow-paper animate-in fade-in-0 zoom-in-95">
          {toast}
        </div>
      )}
    </div>
  );
}
