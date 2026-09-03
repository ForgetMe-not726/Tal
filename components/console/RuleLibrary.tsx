"use client";

import * as React from "react";
import { FileCode2, History, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 规则库管理(灰箱接口)· 真实 CRUD
// 数据来自 Supabase(rules / rule_versions),经 /api/rules 读写。
// 版本流转:编辑草稿(Draft)→ 发布(Published,旧版自动废弃 Deprecated)。
// ---------------------------------------------------------------------------

interface RuleVersionVM {
  id: string;
  version_number: number;
  status: "draft" | "published" | "deprecated";
  instruction: string;
  constraints: Record<string, unknown>;
  change_note: string;
  created_by: string;
  created_at: string;
  published_at: string | null;
}

interface RuleVM {
  id: string;
  rule_key: string;
  display_name: string;
  rule_type: "generation" | "review";
  is_hard: boolean;
  description: string;
  versions: RuleVersionVM[];
}

const STATUS_LABEL: Record<RuleVersionVM["status"], string> = {
  draft: "草稿",
  published: "生效中",
  deprecated: "已废弃",
};

const STATUS_BADGE: Record<RuleVersionVM["status"], "spot" | "reg" | "outline"> = {
  draft: "spot",
  published: "reg",
  deprecated: "outline",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

interface RuleLibraryProps {
  /** 首屏数据由服务端组件(app/page.tsx)读取提供,客户端只做重试与变更后更新 */
  initialRules: RuleVM[] | null;
  initialError: string | null;
}

export function RuleLibrary({ initialRules, initialError }: RuleLibraryProps) {
  const [rules, setRules] = React.useState<RuleVM[] | null>(initialRules);
  const [loadError, setLoadError] = React.useState<string | null>(initialError);

  const [openRule, setOpenRule] = React.useState<RuleVM | null>(null);
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [constraintsText, setConstraintsText] = React.useState("{}");
  const [changeNote, setChangeNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/rules", { cache: "no-store" });
      const data = (await res.json()) as { rules?: RuleVM[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setRules(data.rules ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }

  React.useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [toast]);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
  }

  function adoptVersion(rule: RuleVM, version: RuleVersionVM | null) {
    setSelectedVersionId(version?.id ?? null);
    setInstruction(version?.instruction ?? "");
    setConstraintsText(JSON.stringify(version?.constraints ?? {}, null, 2));
    setChangeNote(version?.change_note ?? "");
  }

  function openEditor(rule: RuleVM) {
    const draft = rule.versions.find((v) => v.status === "draft");
    const published = rule.versions.find((v) => v.status === "published");
    const init = draft ?? published ?? rule.versions[0] ?? null;
    setOpenRule(rule);
    adoptVersion(rule, init);
  }

  function patchVersion(updated: RuleVersionVM) {
    const merge = (r: RuleVM): RuleVM => ({
      ...r,
      versions: r.versions.some((v) => v.id === updated.id)
        ? r.versions.map((v) => (v.id === updated.id ? updated : v))
        : [updated, ...r.versions],
    });
    setRules((prev) => (prev ? prev.map((r) => (r.id === openRule?.id ? merge(r) : r)) : prev));
    setOpenRule((prev) => (prev ? merge(prev) : prev));
    setSelectedVersionId(updated.id);
    adoptVersion(openRule as RuleVM, updated);
  }

  const selectedVersion = openRule?.versions.find((v) => v.id === selectedVersionId) ?? null;
  const isDraftSelected = selectedVersion?.status === "draft";

  async function handleSaveDraft() {
    if (!openRule || !selectedVersion) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${openRule.id}/versions/${selectedVersion.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          constraints: constraintsText,
          changeNote,
        }),
      });
      const data = (await res.json()) as { version?: RuleVersionVM; error?: string };
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      patchVersion(data.version as RuleVersionVM);
      showToast("ok", `草稿 v${selectedVersion.version_number} 已保存`);
    } catch (e) {
      showToast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!openRule || !selectedVersion) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/rules/${openRule.id}/versions/${selectedVersion.id}/publish`,
        { method: "POST" },
      );
      const data = (await res.json()) as { version?: RuleVersionVM; error?: string };
      if (!res.ok) throw new Error(data.error ?? "发布失败");
      patchVersion(data.version as RuleVersionVM);
      showToast("ok", `v${selectedVersion.version_number} 已发布,旧版本自动废弃`);
    } catch (e) {
      showToast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDraft() {
    if (!openRule || !selectedVersion) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rules/${openRule.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: selectedVersion.instruction,
          constraints: selectedVersion.constraints,
          changeNote: `基于 v${selectedVersion.version_number} 新建`,
        }),
      });
      const data = (await res.json()) as { version?: RuleVersionVM; error?: string };
      if (!res.ok) throw new Error(data.error ?? "新建草稿失败");
      patchVersion(data.version as RuleVersionVM);
      showToast("ok", "已新建草稿,可以开始编辑");
    } catch (e) {
      showToast("err", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {rules === null && !loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-paper px-4 py-6 text-sm text-ink-2 shadow-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          正在加载规则库…
        </div>
      )}

      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-proof/40 bg-paper px-4 py-3 text-sm text-proof shadow-sm">
          <span>规则库加载失败:{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}

      {rules !== null && !loadError && (
        <div className="overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
          <ul className="divide-y divide-line">
            {rules.map((rule) => {
              const draft = rule.versions.find((v) => v.status === "draft");
              const published = rule.versions.find((v) => v.status === "published");
              return (
                <li key={rule.id} className="flex items-center gap-4 px-4 py-3">
                  <FileCode2 className="size-5 shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {rule.display_name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-3">
                        {rule.rule_key}
                      </span>
                      {rule.is_hard && (
                        <Badge variant="outline" className="border-proof/40 text-proof">
                          红线 · 不可覆盖
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-3">{rule.description}</p>
                  </div>
                  {draft ? (
                    <Badge variant="spot">草稿 v{draft.version_number}</Badge>
                  ) : published ? (
                    <Badge variant="reg">生效中 v{published.version_number}</Badge>
                  ) : (
                    <Badge variant="outline">未发布</Badge>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openEditor(rule)}>
                    <Pencil className="size-3.5" />
                    查看/编辑
                  </Button>
                </li>
              );
            })}
            {rules.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-3">
                规则库为空——请先在数据库中初始化规则,或由教研老师在系统中录入。
              </li>
            )}
          </ul>
        </div>
      )}

      <Dialog
        open={openRule !== null}
        onOpenChange={(open) => {
          if (!open) setOpenRule(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {openRule && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <FileCode2 className="size-4 shrink-0 text-ink-3" />
                  {openRule.display_name}
                  <Badge variant={openRule.rule_type === "review" ? "spot" : "default"}>
                    {openRule.rule_type === "review" ? "审校规则" : "生成规则"}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {openRule.rule_key}
                  {openRule.is_hard && " · Hard Rule(生成时不可被下级规则覆盖)"}
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-ink-2">版本</span>
                <Select
                  value={selectedVersionId ?? undefined}
                  onValueChange={(id) => {
                    const v = openRule.versions.find((x) => x.id === id) ?? null;
                    adoptVersion(openRule, v);
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="选择版本" />
                  </SelectTrigger>
                  <SelectContent>
                    {openRule.versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_number} · {STATUS_LABEL[v.status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedVersion && (
                  <span className="text-[11px] text-ink-3">
                    {selectedVersion.created_by} · {formatDate(selectedVersion.created_at)}
                  </span>
                )}
              </div>

              {selectedVersion && !isDraftSelected && (
                <div className="space-y-3">
                  <div className="whitespace-pre-wrap rounded-md border border-line bg-sheet px-4 py-3 text-[13px] leading-relaxed text-ink">
                    {selectedVersion.instruction}
                  </div>
                  <div className="rounded-md border border-line px-3 py-2">
                    <p className="text-[11px] font-medium text-ink-2">
                      机器可读约束(程序执行的确定性检查)
                    </p>
                    <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-ink-2">
                      {JSON.stringify(selectedVersion.constraints, null, 2)}
                    </pre>
                  </div>
                  <Button onClick={() => void handleCreateDraft()} disabled={busy}>
                    <Plus className="size-3.5" />
                    基于此版本新建草稿
                  </Button>
                </div>
              )}

              {selectedVersion && isDraftSelected && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-2">
                      规则说明(人类可读,将拼入 AI Prompt)
                    </label>
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      spellCheck={false}
                      className="min-h-[200px] font-mono text-[13px] leading-relaxed"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-2">
                      机器可读约束(JSON,程序执行的确定性检查)
                    </label>
                    <Textarea
                      value={constraintsText}
                      onChange={(e) => setConstraintsText(e.target.value)}
                      spellCheck={false}
                      className="min-h-[72px] font-mono text-[12px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-2">变更说明(可选)</label>
                    <Textarea
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      className="min-h-[44px] text-[13px]"
                      placeholder="例如:阅读字数上限从 150 调整为 180"
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
                      保存草稿
                    </Button>
                    <Button onClick={() => void handlePublish()} disabled={busy}>
                      {busy && <Loader2 className="size-3.5 animate-spin" />}
                      发布此版本
                    </Button>
                  </DialogFooter>
                </div>
              )}

              <div className="rounded-md border border-line bg-canvas/50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
                  <History className="size-3.5" />
                  版本历史(旧版本永久保留,可随时追溯)
                </p>
                <ul className="mt-1.5 space-y-1">
                  {openRule.versions.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 text-[11px] text-ink-2">
                      <span className="font-mono">v{v.version_number}</span>
                      <Badge variant={STATUS_BADGE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
                      <span className="truncate">{v.change_note || "—"}</span>
                      <span className="ml-auto shrink-0 font-mono text-ink-3">
                        {formatDate(v.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-paper animate-in fade-in-0 zoom-in-95",
            toast.kind === "ok" ? "bg-reg text-white" : "bg-proof text-white",
          )}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
