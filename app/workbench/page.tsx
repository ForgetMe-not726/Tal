"use client";

import * as React from "react";
import { WorkbenchLeftPanel } from "@/components/workbench/WorkbenchLeftPanel";
import { WorkbenchCenter } from "@/components/workbench/WorkbenchCenter";
import { WorkbenchRightPanel } from "@/components/workbench/WorkbenchRightPanel";
import {
  BOOK_TYPES,
  DEFAULT_LEVEL,
  MODULES,
  UNIT_NO,
  plateLetter,
  plateTone,
} from "@/lib/mock";
import type {
  BookTypeId,
  GeneratedBlock,
  Level,
  ModuleDef,
} from "@/lib/types";

function makeFileName(level: Level, bookTypeId: BookTypeId) {
  const label = BOOK_TYPES.find((b) => b.id === bookTypeId)?.label ?? "";
  return `${level}-${label}-${UNIT_NO}.docx`;
}

export default function WorkbenchPage() {
  const [level, setLevel] = React.useState<Level>(DEFAULT_LEVEL);
  const [bookType, setBookType] = React.useState<BookTypeId>("student");
  const [fileName, setFileName] = React.useState(() =>
    makeFileName(DEFAULT_LEVEL, "student"),
  );
  const [blocks, setBlocks] = React.useState<GeneratedBlock[]>([]);
  const [loadingModule, setLoadingModule] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const modules = MODULES[bookType];

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleLevelChange(next: Level) {
    setLevel(next);
    setFileName(makeFileName(next, bookType));
  }

  function handleBookTypeChange(next: BookTypeId) {
    setBookType(next);
    setBlocks([]); // 切换书种 = 切换文档，清空已生成内容
    setFileName(makeFileName(level, next));
  }

  function handleGenerate(module: ModuleDef) {
    if (loadingModule) return;
    const index = modules.findIndex((m) => m.id === module.id);
    setLoadingModule(module.id);
    window.setTimeout(() => {
      setBlocks((prev) => [
        ...prev,
        {
          id: `${module.id}-${prev.length + 1}`,
          moduleLabel: module.label,
          markdown: module.markdown,
          seq: prev.length + 1,
          bookTypeId: bookType,
          tone: plateTone(index),
          letter: plateLetter(index),
        },
      ]);
      setLoadingModule(null);
    }, 1500);
  }

  return (
    <div className="flex h-screen min-w-0 flex-1">
      <WorkbenchLeftPanel
        level={level}
        bookType={bookType}
        plateCount={blocks.length}
        totalPlates={modules.length}
        onLevelChange={handleLevelChange}
        onBookTypeChange={handleBookTypeChange}
      />
      <WorkbenchCenter
        fileName={fileName}
        blocks={blocks}
        loadingModule={loadingModule}
        modules={modules}
        onRename={setFileName}
        onSave={() => setToast("已保存草稿（模拟）")}
        onExport={() => setToast("已导出 .docx（模拟）")}
      />
      <WorkbenchRightPanel
        bookType={bookType}
        blocks={blocks}
        loadingModule={loadingModule}
        onGenerate={handleGenerate}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-chrome px-4 py-2 text-sm text-paper shadow-paper animate-in fade-in-0 zoom-in-95">
          {toast}
        </div>
      )}
    </div>
  );
}
