"use client";

import * as React from "react";
import { FileCode2, Pencil } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { RULE_FILES } from "@/lib/mock";
import type { RuleFile } from "@/lib/types";

export function RuleLibrary() {
  const [contents, setContents] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(RULE_FILES.map((r) => [r.id, r.content])),
  );
  const [editing, setEditing] = React.useState<RuleFile | null>(null);
  const [draft, setDraft] = React.useState("");
  const [savedId, setSavedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!savedId) return;
    const t = setTimeout(() => setSavedId(null), 2500);
    return () => clearTimeout(t);
  }, [savedId]);

  function openEdit(file: RuleFile) {
    setEditing(file);
    setDraft(contents[file.id] ?? file.content);
  }

  function save() {
    if (!editing) return;
    setContents((prev) => ({ ...prev, [editing.id]: draft }));
    setSavedId(editing.id);
    setEditing(null);
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
      <ul className="divide-y divide-line">
        {RULE_FILES.map((file) => (
          <li key={file.id} className="flex items-center gap-4 px-4 py-3">
            <FileCode2 className="size-5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm text-ink">
                  {file.name}
                </span>
                {savedId === file.id && <Badge variant="reg">已保存</Badge>}
              </div>
              <p className="truncate text-xs text-ink-3">{file.desc}</p>
            </div>
            <Badge variant="outline">生效中</Badge>
            <Button variant="outline" size="sm" onClick={() => openEdit(file)}>
              <Pencil className="size-3.5" />
              查看/编辑
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-base">
              <FileCode2 className="size-4 shrink-0 text-ink-3" />
              {editing?.name}
            </DialogTitle>
            <DialogDescription>
              {editing?.desc} · 灰箱接口：修改此文件会改变 AI
              的生成行为（仅前端状态演示）
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-[320px] font-mono text-[13px] leading-relaxed"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
