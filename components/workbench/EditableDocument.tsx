"use client";

import * as React from "react";
import TurndownService from "turndown";
import { MarkdownContent } from "@/components/workbench/MarkdownContent";
import { normalizeRoundTripMarkdown } from "@/lib/markdown/round-trip";

type EditableDocumentProps = {
  content: string;
  /** 透传给渲染层的模块信息，用于按板块套版式。 */
  bookType?: string;
  moduleKey?: string;
  moduleTitle?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onChange: (markdown: string) => void;
};

/**
 * 富文本编辑区：显示的是排版后的稿子，而不是 Markdown 源码。
 *
 * 做法是渲染 Markdown → 允许直接编辑渲染结果 → 失焦时把 DOM 转回 Markdown。
 * Markdown 始终是唯一数据源，保存/版本/检查流程保持不变。
 */
export function EditableDocument({
  content,
  bookType,
  moduleKey,
  moduleTitle,
  disabled = false,
  onFocus,
  onChange,
}: EditableDocumentProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const turndown = React.useMemo(() => createTurndown(), []);

  // 编辑过程不写 state：React 重渲染会重建子节点并把光标顶回开头。
  // 失焦时再把 DOM 转回 Markdown 交给上层。
  function commit() {
    const node = containerRef.current;
    if (!node) return;
    const markdown = normalizeRoundTripMarkdown(turndown.turndown(node.innerHTML));
    if (markdown !== content) onChange(markdown);
  }

  return (
    <div
      ref={containerRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="知识清单正文"
      tabIndex={0}
      onFocus={onFocus}
      onBlur={commit}
      onKeyDown={(event) => {
        // 表格单元格里回车会拆出非法结构，直接拦掉。
        if (event.key === "Enter" && (event.target as HTMLElement).closest("td, th")) {
          event.preventDefault();
        }
      }}
      onPaste={(event) => {
        // 只接受纯文本，避免把外部样式带进正文。
        const text = event.clipboardData.getData("text/plain");
        if (!text) return;
        event.preventDefault();
        document.execCommand("insertText", false, text);
      }}
      className="min-h-[200px] rounded-sm outline-none focus:ring-2 focus:ring-brand/30 focus:ring-offset-4 focus:ring-offset-sheet"
    >
      <MarkdownContent
        content={content}
        bookType={bookType}
        moduleKey={moduleKey}
        moduleTitle={moduleTitle}
      />
    </div>
  );
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    // 单元格内的换行会破坏 GFM 表格，统一转成分号。
    br: "；",
  });

  service.addRule("gfmTable", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = [...(node as HTMLTableElement).rows];
      if (rows.length === 0) return "";
      const cellText = (cell: HTMLTableCellElement) =>
        (cell.textContent ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

      // 词卡字段行在页面上是合并成整行的单个单元格，Markdown 里却是
      // `| 字段名 | 取值 | | |`。不回拆的话，失焦一次就把取值挤进第一列。
      const rowCells = (row: HTMLTableRowElement): string[] => {
        // 「学习目标」的标题行是渲染时从空表头行换出来的，Markdown 里仍是空表头行。
        if (row.querySelector("[data-table-title]")) return [];
        const cells = [...row.cells];
        const field = cells.length === 1 ? cells[0].getAttribute("data-field") : null;
        if (field) {
          const text = cellText(cells[0]);
          const prefix = `${field}：`;
          const value = text.startsWith(prefix) ? text.slice(prefix.length) : text;
          return [field, value, "", ""];
        }
        return cells.map(cellText);
      };

      const header = rowCells(rows[0]);
      const body = rows.slice(1).map(rowCells);
      const columnCount = Math.max(header.length, ...body.map((row) => row.length), 1);
      const pad = (cells: string[]) =>
        Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");

      // 空单元格写成 `| |` 而不是 `|  |`：这样回写结果与生成时的写法逐字一致，
      // 光是点一下正文不会把模块标记成“未保存修改”。
      const rowLine = (cells: string[]) =>
        `|${pad(cells)
          .map((cell) => (cell ? ` ${cell} ` : " "))
          .join("|")}|`;

      const lines = [
        rowLine(header),
        rowLine(Array.from({ length: columnCount }, () => "---")),
        ...body.map(rowLine),
      ];
      return `\n\n${lines.join("\n")}\n\n`;
    },
  });

  service.addRule("cellContent", {
    filter: ["th", "td"],
    replacement: (content) => content,
  });

  return service;
}
