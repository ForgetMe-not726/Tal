"use client";

import * as React from "react";
import { FileImage, X } from "lucide-react";
import { pageImageName } from "@/lib/ocr/page-names";
import { cn } from "@/lib/utils";

/**
 * 「查看原页」：显示 OCR 保存的页图，并在有块坐标时高亮命中区域。
 *
 * 证据呈现的三条纪律（`docs/AI-ASSISTANT-RETRIEVAL.md` §5、§6）：
 * 1. 页图是**来源证据的视图**，不是第二份教材内容；
 * 2. 没有精确坐标时显示整页并**明说「仅定位到页」**，不假装命中；
 * 3. 页图缺失时保留文字定位并提示重新处理来源，**不伪造截图**。
 *
 * 页图走的是资料识别页已经在用的读取路由（路径收敛在任务目录内 + 扩展名白名单）。
 */
export type PageEvidenceBox = { left: number; top: number; width: number; height: number };

export type PageEvidenceProps = {
  /** 来源名称（书名/模块），显示在标题里。 */
  label: string;
  /** 已确认的 OCR 任务；为空表示这条来源定位不到页图。 */
  jobId: string | null;
  /** 0 起的页码；为空表示连页码都没有。 */
  pageIndex: number | null;
  /** 命中区域（百分比）。知识条目目前没有块坐标，通常为空。 */
  box?: PageEvidenceBox | null;
  className?: string;
};

export function PageEvidence({ label, jobId, pageIndex, box, className }: PageEvidenceProps) {
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const locatable = Boolean(jobId) && pageIndex !== null;
  const pageText = pageIndex === null ? "未记录页码" : `第 ${pageIndex + 1} 页`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded border border-line bg-canvas/60 px-1.5 py-0.5 text-[10px] text-ink-2",
          "hover:border-brand/40 hover:text-brand-deep",
          className,
        )}
        title={locatable ? `查看原页 · ${pageText}` : "这条来源没有页图定位"}
      >
        <FileImage className="size-3" />
        查看原页
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`原页证据 · ${label}`}
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-full w-full max-w-[820px] flex-col overflow-hidden rounded-lg bg-paper shadow-paper"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
              <span className="truncate text-xs font-medium text-ink-2">{label}</span>
              <span className="text-[10px] text-ink-3">{pageText}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto rounded p-1 text-ink-3 hover:bg-canvas hover:text-ink"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
              {!locatable ? (
                <p className="mt-10 text-center text-xs leading-relaxed text-ink-3">
                  这条来源没有页图定位（未记录 OCR 任务或页码）。
                  <br />
                  结论里的文字定位仍然有效，可以据此在原书里核对。
                </p>
              ) : failed ? (
                <p className="mt-10 text-center text-xs leading-relaxed text-ink-3">
                  页图缺失或无法读取。
                  <br />
                  请回到资料识别重新处理这份来源；文字定位仍然有效。
                </p>
              ) : (
                <>
                  <div className="relative mx-auto w-full max-w-[620px] rounded-[2px] bg-sheet shadow-paper">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/ocr/${jobId}/raw/pages/${pageImageName(pageIndex!)}`}
                      alt={`${label} 第 ${pageIndex! + 1} 页原图`}
                      className="block w-full rounded-[2px]"
                      onError={() => setFailed(true)}
                      onLoad={() => setFailed(false)}
                    />
                    {box && (
                      <div
                        className="pointer-events-none absolute rounded-[2px] border-2 border-brand bg-brand/15"
                        style={{
                          left: `${box.left * 100}%`,
                          top: `${box.top * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  <p className="mt-2 text-center text-[10px] text-ink-3">
                    {box ? "已高亮命中区域。" : "仅定位到页——这条来源没有块坐标，未高亮具体区域。"}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
