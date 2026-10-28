"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FileCode2, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RuleVersionVM {
  id: string;
  version_number: number;
  status: "draft" | "published" | "deprecated";
  change_note: string;
  created_at: string;
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

type RuleLibraryProps = {
  initialRules: RuleVM[] | null;
  initialError: string | null;
};

const UNGROUPED = "未标注来源的规则";

function latestVersion(rule: RuleVM) {
  return rule.versions[0] ?? null;
}

function versionLabel(version: RuleVersionVM | null) {
  if (!version) return "未发布";
  if (version.status === "published") return `生效中 v${version.version_number}`;
  if (version.status === "draft") return `草稿 v${version.version_number}`;
  return `已废弃 v${version.version_number}`;
}

function versionVariant(version: RuleVersionVM | null): "reg" | "spot" | "outline" {
  if (version?.status === "published") return "reg";
  if (version?.status === "draft") return "spot";
  return "outline";
}

/** 以来源文件为单位分组；description 由导入流程写入文件名。 */
function groupByFile(rules: RuleVM[]) {
  const groups = new Map<string, RuleVM[]>();
  for (const rule of rules) {
    const file = rule.description?.trim() || UNGROUPED;
    const list = groups.get(file) ?? [];
    list.push(rule);
    groups.set(file, list);
  }
  return [...groups.entries()].map(([file, items]) => ({
    file,
    rules: [...items].sort((a, b) => a.rule_key.localeCompare(b.rule_key)),
  }));
}

export function RuleLibrary({ initialRules, initialError }: RuleLibraryProps) {
  const [rules, setRules] = React.useState<RuleVM[] | null>(initialRules);
  const [loadError, setLoadError] = React.useState<string | null>(initialError);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadRules() {
    const response = await fetch("/api/rules", { cache: "no-store" });
    const data = (await response.json()) as { rules?: RuleVM[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "规则库加载失败");
    setRules(data.rules ?? []);
    setLoadError(null);
  }

  async function handleImport(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/rules/import", { method: "POST", body: form });
      const data = (await response.json()) as {
        imported?: Array<{ ruleKey: string; versionNumber: number }>;
        warnings?: string[];
        sourceFile?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "规则导入失败");
      await loadRules();
      const name = data.sourceFile ?? file.name;
      setExpanded((previous) => ({ ...previous, [name]: true }));
      const count = data.imported?.length ?? 0;
      const warning = data.warnings?.[0];
      setToast({
        kind: warning ? "err" : "ok",
        text: warning
          ? `已导入 ${name}（${count} 条），但有字段未生效：${warning}`
          : `已导入规则文件 ${name}（${count} 条规则）`,
      });
    } catch (error) {
      setToast({ kind: "err", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFile(file: string, groupRules: RuleVM[]) {
    if (busy) return;
    if (!window.confirm(`确定删除规则文件“${file}”及其 ${groupRules.length} 条规则吗？`)) return;
    setBusy(true);
    try {
      for (const rule of groupRules) {
        const response = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `删除 ${rule.rule_key} 失败`);
        }
      }
      setRules((previous) => previous?.filter((item) => !groupRules.some((rule) => rule.id === item.id)) ?? previous);
      setToast({ kind: "ok", text: `已删除规则文件：${file}` });
    } catch (error) {
      await loadRules().catch(() => undefined);
      setToast({ kind: "err", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const groups = rules ? groupByFile(rules) : [];

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
          <span>规则库加载失败：{loadError}</span>
          <button type="button" className="underline" onClick={() => void loadRules()}>
            重试
          </button>
        </div>
      )}

      {rules !== null && !loadError && (
        <div className="overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <span className="text-xs text-ink-3">
              {groups.length > 0 ? `${groups.length} 个规则文件` : "规则库为空"}
            </span>
            <label
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand-deep",
                busy && "pointer-events-none opacity-60",
              )}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              导入
              <input
                type="file"
                accept=".md,.markdown,text/markdown"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImport(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <ul className="divide-y divide-line">
            {groups.map((group) => {
              const isOpen = expanded[group.file] ?? false;
              const hardCount = group.rules.filter((rule) => rule.is_hard).length;
              return (
                <li key={group.file}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded((previous) => ({ ...previous, [group.file]: !isOpen }))}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0 text-ink-3" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-ink-3" />
                      )}
                      <FileCode2 className="size-5 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{group.file}</span>
                        <span className="mt-0.5 block text-xs text-ink-3">
                          {group.rules.length} 条规则
                          {hardCount > 0 ? ` · ${hardCount} 条红线` : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDeleteFile(group.file, group.rules)}
                      aria-label={`删除规则文件 ${group.file}`}
                      title="删除规则文件"
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-proof/10 hover:text-proof disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {isOpen && (
                    <ul className="border-t border-line bg-canvas/40 px-4 py-2">
                      {group.rules.map((rule) => {
                        const latest = latestVersion(rule);
                        return (
                          <li key={rule.id} className="flex items-center gap-2 py-1.5 text-xs">
                            <span className="font-mono text-[11px] text-ink-3">{rule.rule_key}</span>
                            <span className="min-w-0 flex-1 truncate text-ink">{rule.display_name}</span>
                            {rule.is_hard && (
                              <Badge variant="outline" className="border-proof/40 text-proof">
                                红线
                              </Badge>
                            )}
                            <Badge variant={rule.rule_type === "review" ? "spot" : "outline"}>
                              {rule.rule_type === "review" ? "审校" : "生成"}
                            </Badge>
                            <Badge variant={versionVariant(latest)}>{versionLabel(latest)}</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-paper",
            toast.kind === "ok" ? "bg-reg" : "bg-proof",
          )}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
