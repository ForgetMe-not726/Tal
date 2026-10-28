"use client";

import * as React from "react";
import { ReviewFindingPanel } from "@/components/review/ReviewFindingPanel";
import {
  ReviewLeftPanel,
  JOB_STATUS_LABEL,
  type ReviewFilters,
  type ReviewLesson,
  type ReviewProject,
} from "@/components/review/ReviewLeftPanel";
import { MarkdownContent } from "@/components/workbench/MarkdownContent";
import { CropMarks, PlateSwatch } from "@/components/print-marks";
import { applySuggestionToMarkdown } from "@/lib/suggestions/apply";
import type {
  ReviewFinding,
  ReviewJobRecord,
  ReviewManifest,
  ReviewScope,
} from "@/lib/review/types";
import type { BookTypeId } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_MS = 2500;

type VersionSummary = {
  id: string;
  version_number: number;
  content?: { markdown?: string; metadata?: Record<string, unknown> } | null;
};

type ModuleSummary = { moduleKey: string; label: string; versionNumber: number; moduleId: string };

export default function ReviewPage() {
  const [projects, setProjects] = React.useState<ReviewProject[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [lessons, setLessons] = React.useState<ReviewLesson[]>([]);
  const [lessonNumber, setLessonNumber] = React.useState<number | null>(null);
  const [scope, setScope] = React.useState<ReviewScope>("module");
  const [bookType, setBookType] = React.useState<BookTypeId>("student");
  const [moduleKey, setModuleKey] = React.useState("");
  const [availableModules, setAvailableModules] = React.useState<ModuleSummary[]>([]);
  const [jobs, setJobs] = React.useState<ReviewJobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [manifest, setManifest] = React.useState<ReviewManifest | null>(null);
  const [findings, setFindings] = React.useState<ReviewFinding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = React.useState<string | null>(null);
  const [markdown, setMarkdown] = React.useState("");
  const [savedMarkdown, setSavedMarkdown] = React.useState("");
  const [activeModuleId, setActiveModuleId] = React.useState<string | null>(null);
  const [filters, setFilters] = React.useState<ReviewFilters>({
    bookType: "all",
    status: "all",
    locatedOnly: false,
  });
  const [starting, setStarting] = React.useState(false);
  const [deciding, setDeciding] = React.useState(false);
  const [adopting, setAdopting] = React.useState(false);
  const [generatingReport, setGeneratingReport] = React.useState(false);
  const [reportReady, setReportReady] = React.useState(false);
  const [reportHtml, setReportHtml] = React.useState<string | null>(null);
  const [viewingReport, setViewingReport] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const requestEpoch = React.useRef(0);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const jobStatus = selectedJob?.status ?? "queued";
  const dirty = markdown !== savedMarkdown;
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? null;

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  // 项目
  React.useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { projects?: ReviewProject[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "项目列表加载失败");
        if (!active) return;
        setProjects(data.projects ?? []);
        setProjectId((current) => current || data.projects?.[0]?.id || "");
      })
      .catch((error: unknown) => active && setToast((error as Error).message));
    return () => {
      active = false;
    };
  }, []);

  // Lesson 列表：从工作区里已存在的课目录取（有内容的课才审得了）
  React.useEffect(() => {
    if (!projectId) return;
    let active = true;
    void fetch(`/api/review/context?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { lessons?: ReviewLesson[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Lesson 列表加载失败");
        if (!active) return;
        setLessons(data.lessons ?? []);
        setLessonNumber((current) => current ?? data.lessons?.[0]?.lessonNumber ?? null);
      })
      .catch(() => active && setLessons([]));
    return () => {
      active = false;
    };
  }, [projectId]);

  // 可选模块：这一课这本书下已有版本的模块
  React.useEffect(() => {
    if (!projectId || !lessonNumber) return;
    let active = true;
    void fetch(
      `/api/review/context?projectId=${encodeURIComponent(projectId)}&lessonNumber=${lessonNumber}&bookType=${bookType}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = (await response.json()) as { modules?: ModuleSummary[] };
        if (!active) return;
        setAvailableModules(data.modules ?? []);
        setModuleKey((current) => (data.modules?.some((m) => m.moduleKey === current) ? current : data.modules?.[0]?.moduleKey ?? ""));
      })
      .catch(() => active && setAvailableModules([]));
    return () => {
      active = false;
    };
  }, [projectId, lessonNumber, bookType]);

  const loadJobs = React.useCallback(async (epoch: number) => {
    if (!projectId || !lessonNumber) return;
    const response = await fetch(
      `/api/review?projectId=${encodeURIComponent(projectId)}&lessonNumber=${lessonNumber}`,
      { cache: "no-store" },
    );
    const data = (await response.json()) as { jobs?: ReviewJobRecord[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "审校任务加载失败");
    if (epoch !== requestEpoch.current) return;
    setJobs(data.jobs ?? []);
  }, [projectId, lessonNumber]);

  React.useEffect(() => {
    const epoch = requestEpoch.current;
    void loadJobs(epoch).catch((error: unknown) => setToast((error as Error).message));
  }, [loadJobs]);

  const anyRunning = jobs.some((job) => job.status === "running" || job.status === "queued");
  React.useEffect(() => {
    if (!anyRunning) return;
    const epoch = requestEpoch.current;
    const timer = setInterval(() => void loadJobs(epoch).catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, loadJobs]);

  /** 载入一次审校的结果：manifest + findings + 被审版本的正文。 */
  const loadJob = React.useCallback(
    async (jobId: string, epoch: number, options: { keepSelection?: boolean } = {}) => {
      const response = await fetch(`/api/review/${jobId}`, { cache: "no-store" });
      const data = (await response.json()) as {
        job?: ReviewJobRecord;
        manifest?: ReviewManifest | null;
        findings?: ReviewFinding[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "审校结果加载失败");
      if (epoch !== requestEpoch.current) return;
      setManifest(data.manifest ?? null);
      setFindings(data.findings ?? []);
      if (!options.keepSelection) setSelectedFindingId(data.findings?.[0]?.id ?? null);
      const inputs = data.manifest?.inputs ?? [];
      setActiveModuleId(inputs[0]?.moduleId ?? null);
      setReportReady(Boolean(data.manifest?.reportGeneratedAt));
    },
    [],
  );

  // 被审版本的正文：按 manifest 里记的 versionId 取，**不取最新版**——
  // 审的是哪一版就显示哪一版，否则定位会对不上。
  const activeInput = manifest?.inputs.find((input) => input.moduleId === activeModuleId) ?? manifest?.inputs[0] ?? null;
  React.useEffect(() => {
    if (!activeInput) return;
    let active = true;
    void fetch(`/api/modules/versions?moduleId=${encodeURIComponent(activeInput.moduleId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { versions?: VersionSummary[] };
        if (!active) return;
        const version = (data.versions ?? []).find((item) => item.id === activeInput.versionId);
        const text = version?.content?.markdown ?? "";
        setMarkdown(text);
        setSavedMarkdown(text);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeInput]);
  // 没有选中版本时显示空正文（派生，不在 effect 里同步改 state）
  const displayMarkdown = activeInput ? markdown : "";

  React.useEffect(() => {
    if (!selectedJobId) return;
    const epoch = requestEpoch.current;
    void loadJob(selectedJobId, epoch).catch((error: unknown) => setToast((error as Error).message));
  }, [selectedJobId, loadJob]);

  React.useEffect(() => {
    if (!selectedJobId || !anyRunning) return;
    const epoch = requestEpoch.current;
    const timer = setInterval(
      () => void loadJob(selectedJobId, epoch, { keepSelection: true }).catch(() => undefined),
      POLL_MS,
    );
    return () => clearInterval(timer);
  }, [selectedJobId, anyRunning, loadJob]);

  const filteredFindings = React.useMemo(
    () =>
      findings.filter(
        (finding) =>
          (filters.bookType === "all" || finding.bookType === filters.bookType) &&
          (filters.status === "all" || (finding.decision?.action ?? "pending") === filters.status) &&
          (!filters.locatedOnly || finding.anchor.blockIndex !== null),
      ),
    [findings, filters],
  );

  async function handleStart() {
    if (!projectId || !lessonNumber) return;
    setStarting(true);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          lessonNumber,
          scope,
          bookType,
          moduleKey: scope === "module" ? moduleKey : undefined,
        }),
      });
      const data = (await response.json()) as { jobId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "审校启动失败");
      setToast("已开始审校");
      setSelectedJobId(data.jobId!);
      await loadJobs(requestEpoch.current);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handleDecide(findingId: string, action: "adopt" | "ignore" | "recheck", note?: string) {
    if (!selectedJobId || deciding) return;
    setDeciding(true);
    try {
      const response = await fetch(`/api/review/${selectedJobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, action, note }),
      });
      const data = (await response.json()) as { findings?: ReviewFinding[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "保存决定失败");
      setFindings(data.findings ?? []);
      setToast(action === "adopt" ? "已采用建议" : action === "ignore" ? "已忽略" : "已标记复查");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  /**
   * 采用建议：只改当前草稿，保存后才生成新版本。
   *
   * 与工作台的修改建议同一条通路（`applySuggestionToMarkdown` + `/api/modules/versions`），
   * 并且同样要求草稿与所审版本一致——否则会拿着过期的问题去改已经变了的正文。
   */
  async function handleAdoptSuggestion(finding: ReviewFinding) {
    if (!finding.suggestion || dirty || adopting || !selectedJobId) return;
    setAdopting(true);
    try {
      // 只传应用建议真正需要的三个字段：审校结论没有严重度，也不该为了调用它编一个出来
      const applied = applySuggestionToMarkdown(markdown, {
        kind: "replace",
        originalText: finding.anchor.quote,
        replacementText: finding.suggestion,
      });
      if (!applied.changed) {
        setToast(`没能把建议应用到正文（${applied.reason}），请手工修改`);
        return;
      }
      const project = projects.find((item) => item.id === projectId);
      const save = await fetch("/api/modules/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectName: project?.name ?? "本地项目",
          projectId,
          grade: project?.grade ?? "L5",
          term: project?.term ?? "winter",
          lessonNumber,
          lessonTitle: lessons.find((lesson) => lesson.lessonNumber === lessonNumber)?.title ?? "",
          bookType: finding.bookType,
          moduleKey: finding.moduleKey,
          moduleLabel: finding.moduleLabel,
          markdown: applied.markdown,
          basedOnVersionId: finding.versionId,
        }),
      });
      const saved = (await save.json()) as { error?: string };
      if (!save.ok) throw new Error(saved.error ?? "保存新版本失败");
      setMarkdown(applied.markdown);
      setSavedMarkdown(applied.markdown);
      await handleDecide(finding.id, "adopt", finding.decision?.note);
      setToast("已采用建议并保存为新版本");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setAdopting(false);
    }
  }

  async function handleGenerateReport() {
    if (!selectedJobId || generatingReport) return;
    setGeneratingReport(true);
    try {
      const response = await fetch(`/api/review/${selectedJobId}/report`, { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "生成报告失败");
      setReportReady(true);
      setToast("报告已生成");
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setGeneratingReport(false);
    }
  }

  async function handleViewReport() {
    if (viewingReport) {
      setViewingReport(false);
      return;
    }
    if (!selectedJobId) return;
    const response = await fetch(`/api/review/${selectedJobId}/report`, { cache: "no-store" });
    if (!response.ok) {
      setToast("还没有生成报告");
      return;
    }
    setReportHtml(await response.text());
    setViewingReport(true);
  }

  const canStart = Boolean(projectId && lessonNumber && (scope === "book" || moduleKey));
  const startHint = !projectId
    ? "先选择项目"
    : !lessonNumber
      ? "这一课还没有内容"
      : scope === "module" && !moduleKey
        ? availableModules.length === 0
          ? ""
          : "选择要审的模块"
        : "";

  return (
    <div className="flex h-screen min-w-0 flex-1">
      <ReviewLeftPanel
        projects={projects}
        projectId={projectId}
        onProjectChange={(id) => {
          requestEpoch.current += 1;
          setProjectId(id);
          setLessonNumber(null);
          setSelectedJobId(null);
          setManifest(null);
          setFindings([]);
        }}
        lessons={lessons}
        lessonNumber={lessonNumber}
        onLessonChange={(value) => {
          requestEpoch.current += 1;
          setLessonNumber(value);
          setSelectedJobId(null);
          setManifest(null);
          setFindings([]);
        }}
        scope={scope}
        onScopeChange={setScope}
        bookType={bookType}
        onBookTypeChange={setBookType}
        moduleKey={moduleKey}
        onModuleKeyChange={setModuleKey}
        availableModules={availableModules}
        jobs={jobs}
        selectedJobId={selectedJobId}
        onSelectJob={(jobId) => {
          if (jobId === selectedJobId) return;
          setSelectedJobId(jobId);
          setManifest(null);
          setFindings([]);
          setSelectedFindingId(null);
          setViewingReport(false);
        }}
        starting={starting}
        onStart={() => void handleStart()}
        canStart={canStart}
        startHint={startHint}
        manifest={manifest}
        filters={filters}
        onFiltersChange={setFilters}
        ruleKeys={[...new Set(findings.map((finding) => finding.ruleKey))]}
      />

      {/* 中栏：正文（可定位）或只读报告 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-paper px-3 sm:px-4">
          <span className="text-xs font-medium text-ink-2">
            {viewingReport
              ? "审校报告（只读）"
              : activeInput
                ? `${activeInput.bookType}/${activeInput.moduleLabel} · v${activeInput.versionNumber}`
                : "正文"}
          </span>
          <span className="flex items-center gap-2 text-[10px] text-ink-3">
            {selectedJob && (
              <span className={cn(jobStatus === "ready" && "text-spot", jobStatus === "failed" && "text-proof")}>
                {JOB_STATUS_LABEL[jobStatus]}
              </span>
            )}
            {dirty && <span className="text-amber-700">草稿有未保存改动</span>}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-canvas p-6 sm:p-10">
          {viewingReport && reportHtml ? (
            <div className="relative mx-auto w-full max-w-[980px]">
              <div className="overflow-hidden rounded-[2px] bg-sheet shadow-paper">
                {/* 报告是生成时已转义、无脚本的静态 HTML，这里只做展示 */}
                <iframe
                  title="审校报告"
                  srcDoc={reportHtml}
                  sandbox=""
                  className="h-[80vh] w-full border-0"
                />
              </div>
            </div>
          ) : (
            <div className="relative mx-auto w-full max-w-[760px]">
              <div className="relative rounded-[2px] bg-sheet shadow-paper">
                <CropMarks />
                <div className="px-10 py-12 sm:px-14">
                  {displayMarkdown ? (
                    <MarkdownContent
                      content={displayMarkdown}
                      bookType={activeInput?.bookType}
                      moduleKey={activeInput?.moduleKey}
                      moduleTitle={activeInput?.moduleLabel}
                      highlightQuote={selectedFinding?.anchor.quote ?? null}
                    />
                  ) : (
                    <p className="py-16 text-center text-xs text-ink-3">左侧开始审校后，这里显示正文</p>
                  )}
                </div>
              </div>
              {activeInput && (
                <div className="absolute -top-5 right-0">
                  <PlateSwatch letter="审" tone="violet" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ReviewFindingPanel
        finding={selectedFinding}
        ruleBasis={
          manifest?.rules.entries.find((entry) => entry.ruleKey === selectedFinding?.ruleKey) ?? null
        }
        findings={filteredFindings}
        onSelect={(findingId) => setSelectedFindingId(findingId)}
        deciding={deciding}
        onDecide={(findingId, action, note) => void handleDecide(findingId, action, note)}
        onAdoptSuggestion={(finding) => void handleAdoptSuggestion(finding)}
        adopting={adopting}
        draftDirty={dirty}
        reportReady={reportReady}
        generatingReport={generatingReport}
        onGenerateReport={() => void handleGenerateReport()}
        onViewReport={() => void handleViewReport()}
        viewingReport={viewingReport}
        jobStatus={jobStatus}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-chrome px-4 py-2 text-sm text-paper shadow-paper animate-in fade-in-0 zoom-in-95">
          {toast}
        </div>
      )}
    </div>
  );
}
