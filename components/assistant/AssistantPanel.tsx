"use client";

import * as React from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { PageEvidence } from "@/components/evidence/PageEvidence";
import { Button } from "@/components/ui/button";
import { SOURCE_KIND_LABEL, type AssistantHit, type AssistantSourceKind } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";

type ProjectOption = { id: string; name: string; grade: string; term: string };

type SearchResponse = {
  adapter?: { name: string; description: string };
  plan?: { keywords: string[]; source: "model" | "keywords"; note: string; dropped: string[] };
  hits?: AssistantHit[];
  searched?: {
    scope: string;
    projects: number;
    lessons: number;
    entries: number;
    rules: number;
    versions: number;
    references: number;
  };
  gaps?: string[];
  error?: string;
};

/**
 * 主页的通用助手（`PRODUCT.md` §4.4、`DESIGN.md` §193-199）。
 *
 * 结构固定为「问题输入 — 检索结果 — 原页证据」：**结果就是答案**，
 * 没有模型总结，也就没有编造空间（profile §7.4）。
 * 只读边界在空状态与结果操作里始终可见——这里不出现任何"应用到教材"的入口。
 */
export function AssistantPanel() {
  const [question, setQuestion] = React.useState("");
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [scope, setScope] = React.useState<"workspace" | "project">("workspace");
  const [projectId, setProjectId] = React.useState("");
  const [kind, setKind] = React.useState<AssistantSourceKind | "">("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SearchResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const epoch = React.useRef(0);

  React.useEffect(() => {
    let active = true;
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { projects?: ProjectOption[] };
        if (!active) return;
        setProjects(data.projects ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function submit() {
    const value = question.trim();
    if (!value || busy) return;
    const current = ++epoch.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: value,
          scope,
          projectId: scope === "project" ? projectId : undefined,
          sourceKind: kind || undefined,
          needPageEvidence: true,
        }),
      });
      const data = (await response.json()) as SearchResponse;
      if (!response.ok) throw new Error(data.error ?? "检索失败");
      if (current !== epoch.current) return;
      setResult(data);
    } catch (caught) {
      if (current === epoch.current) setError((caught as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }

  const hits = result?.hits ?? [];

  return (
    <section className="rounded-lg border border-line bg-paper p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Search className="size-4 text-brand" />
          通用助手
        </h2>
        <span
          className="flex shrink-0 items-center gap-1 text-[10px] text-ink-3"
          title="只读：不会改动教材、规则或审校结果"
        >
          <ShieldCheck className="size-3" />
          只读
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="例如：查找 Let's say 中包含 environment 的核心词汇"
          className="h-9 min-w-[280px] flex-1 rounded-md border border-line bg-paper px-3 text-xs text-ink outline-none focus:border-brand"
          aria-label="检索问题"
        />
        <select
          value={scope === "project" ? projectId : ""}
          onChange={(event) => {
            setScope(event.target.value ? "project" : "workspace");
            setProjectId(event.target.value);
          }}
          className="h-9 rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
          aria-label="检索范围"
        >
          <option value="">全工作区</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as AssistantSourceKind | "")}
          className="h-9 rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-brand"
          aria-label="按来源类型筛选"
        >
          <option value="">全部资料</option>
          {(Object.keys(SOURCE_KIND_LABEL) as AssistantSourceKind[]).map((item) => (
            <option key={item} value={item}>
              {SOURCE_KIND_LABEL[item]}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => void submit()} disabled={busy || !question.trim()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          检索
        </Button>
      </div>

      {error && <p className="mt-3 rounded-md border border-proof/30 bg-proof/5 px-3 py-2 text-xs text-proof">{error}</p>}

      {result?.plan && (
        <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
          查询计划：关键词 {result.plan.keywords.join("、") || "（无）"}
          {result.plan.source === "keywords" ? "（未做语义解析）" : ""}
          {result.plan.dropped.length > 0 ? `；已忽略无法识别的条件：${result.plan.dropped.join("、")}` : ""}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-2">
          {hits.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-3/50 px-3 py-6 text-center text-xs leading-relaxed text-ink-3">
              没有找到相关本地资料。
            </div>
          ) : (
            hits.map((hit) => <HitCard key={`${hit.kind}-${hit.sourceRef}-${hit.pageIndex ?? "x"}`} hit={hit} />)
          )}
        </div>
      )}

      {result?.gaps && result.gaps.length > 0 && (
        <ul className="mt-3 space-y-1 text-[10px] leading-relaxed text-ink-3">
          {result.gaps.map((gap) => (
            <li key={gap}>资料缺口 · {gap}</li>
          ))}
        </ul>
      )}

    </section>
  );
}

/** 一条命中：命中内容 — 来源定位 — 原页证据。 */
function HitCard({ hit }: { hit: AssistantHit }) {
  const location = [
    hit.documentName,
    hit.lessonNumber == null ? null : `Lesson ${hit.lessonNumber}`,
    hit.moduleKey,
    hit.pageIndex == null ? null : `第 ${hit.pageIndex + 1} 页`,
  ].filter(Boolean);

  return (
    <article className="rounded-md border border-line bg-sheet p-3">
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-medium",
            hit.status === "confirmed" ? "border-reg/40 text-reg" : "border-spot/40 text-spot",
          )}
        >
          {hit.status === "confirmed" ? "已确认" : "待核对"}
        </span>
        <span className="text-ink-3">{SOURCE_KIND_LABEL[hit.kind]}</span>
        <span className="truncate text-ink-2">{location.join(" · ")}</span>
        {(hit.ocrJobId || hit.pageImageUrl) && hit.pageIndex != null && (
          <span className="ml-auto">
            <PageEvidence
              label={hit.documentName}
              jobId={hit.ocrJobId}
              src={hit.pageImageUrl}
              pageIndex={hit.pageIndex}
              box={hit.box}
            />
          </span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap font-serif text-[12px] leading-relaxed text-ink-2">{hit.snippet}</p>
      <p className="mt-1 font-mono text-[10px] text-ink-3">{hit.sourceRef}</p>
    </article>
  );
}
