"use client";

import * as React from "react";
import type { OcrBlock, OcrPage } from "@/lib/ocr/types";
import { cn } from "@/lib/utils";

export type RecognizePreviewProps = {
  jobId: string;
  page: OcrPage | null;
  blocks: OcrBlock[];
  /** 当前选中的块（与右侧正文联动）。 */
  activeBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
  lowConfidence: string[];
};

/** 块类型的中文名，界面上不暴露引擎的枚举。 */
const TYPE_LABEL: Record<string, string> = {
  title: "标题",
  text: "正文",
  table: "表格",
  image: "图片",
  list: "列表",
  header: "页眉",
  footer: "页脚",
  page_number: "页码",
  aside: "旁注",
  other: "其他",
};

/** 版式信息（页眉页脚页码）不进正文，也不参与高亮，单独标注。 */
const LAYOUT_TYPES = new Set(["header", "footer", "page_number"]);

/**
 * 原页预览：页图 + 块框高亮。
 *
 * 块框用**百分比**定位（引擎给的坐标是归一化的 1000×1000，见 `normalize.ts`），
 * 所以图片按自身比例缩放时框仍然对齐。
 */
export function RecognizePreview({
  jobId,
  page,
  blocks,
  activeBlockId,
  onSelectBlock,
  lowConfidence,
}: RecognizePreviewProps) {
  const pageBlocks = React.useMemo(
    () => blocks.filter((block) => block.pageIndex === (page?.index ?? 0)),
    [blocks, page?.index],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-paper px-3">
        <span className="text-xs font-medium text-ink-2">
          原页 {page ? `第 ${page.index + 1} 页` : "—"}
        </span>
        <span className="text-[10px] text-ink-3">
          {pageBlocks.length} 个块
          {page && page.width > 0 ? ` · ${Math.round(page.width)}×${Math.round(page.height)} pt` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
        {page ? (
          <div className="relative mx-auto w-full max-w-[620px] rounded-[2px] bg-sheet shadow-paper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/ocr/${jobId}/raw/pages/p${String(page.index).padStart(4, "0")}.jpg`}
              alt={`第 ${page.index + 1} 页原图`}
              className="block w-full rounded-[2px]"
            />
            {pageBlocks
              .filter((block) => !LAYOUT_TYPES.has(block.type))
              .map((block) => {
                const active = block.id === activeBlockId;
                const low = lowConfidence.includes(block.id);
                return (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onSelectBlock(block.id)}
                    title={`${TYPE_LABEL[block.type] ?? block.type}：${block.text.slice(0, 40)}`}
                    className={cn(
                      "absolute rounded-[2px] border transition-colors",
                      active
                        ? "border-brand bg-brand/15"
                        : low
                          ? "border-amber-500/60 bg-amber-300/10 hover:bg-amber-300/20"
                          : "border-brand/25 bg-brand/5 hover:bg-brand/15",
                    )}
                    style={{
                      left: `${block.box.left * 100}%`,
                      top: `${block.box.top * 100}%`,
                      width: `${block.box.width * 100}%`,
                      height: `${block.box.height * 100}%`,
                    }}
                  />
                );
              })}
          </div>
        ) : (
          <p className="mt-16 text-center text-xs text-ink-3">选择一个任务查看原页</p>
        )}
      </div>
    </div>
  );
}
