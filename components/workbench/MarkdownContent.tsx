"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveTableTemplate, type TableTemplate } from "@/lib/markdown/table-templates";
import { VOCAB_CARD_HEADER, readWordCardField } from "@/lib/markdown/word-card";
import { cn } from "@/lib/utils";

type MarkdownContentProps = {
  content: string;
  /** 所属书种与模块，用来判断每张表属于哪个板块（见 table-templates）。 */
  bookType?: string;
  moduleKey?: string;
  /** 模块标题（不含编号），「学习目标」表会把它作为跨列居中的首行。 */
  moduleTitle?: string;
  /**
   * 要高亮的原文片段（审校 Finding 的定位）。
   *
   * 用 DOM 文本搜索实现，不引入偏移层：`react-markdown` 不给块索引，
   * 而"找到含这段文字的节点并滚过去"已经足够满足"点一条问题跳到正文位置"。
   * 找不到就不动——**不猜位置**。
   */
  highlightQuote?: string | null;
};

/** 词卡表的列宽，按词卡四个字段的取值长度分配。 */
const WORD_CARD_COLUMNS =
  "[&_th:nth-child(1)]:w-[12%] [&_td:nth-child(1)]:w-[12%] " +
  "[&_th:nth-child(2)]:w-[22%] [&_th:nth-child(3)]:w-[22%] [&_th:nth-child(4)]:w-[44%]";

/**
 * 表格所属板块只在表格内部传递。
 * 同一区块里还有 FCE 派生词表、语法表等，它们不能被当成词卡处理。
 */
const TableTemplateContext = React.createContext<{ template: TableTemplate; moduleTitle?: string }>({
  template: "generic",
});

/** 取一个 React 节点里的纯文本，用于判断某个单元格是不是空的。 */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return textOf(props.children);
  }
  return "";
}

function cellChildren(node: React.ReactNode): React.ReactNode {
  if (React.isValidElement(node)) {
    return (node.props as { children?: React.ReactNode }).children;
  }
  return null;
}

/** 模块下设的板块（`## Let's say!`、`## 核心词汇`）：标题 2。 */
function SectionHeading(props: React.ComponentPropsWithoutRef<"h2">) {
  return <h2 className="mb-2.5 mt-5 text-[17px] font-bold tracking-tight text-ink" {...props} />;
}

/**
 * 板块下设的大题（练习册的 `### 1 Match the...`）：标题 3。
 *
 * 练习册是三层（Day → Let's xxx! → 大题），知识清单只有两层，
 * 所以这里比板块低一级、更小更轻，避免和板块抢视觉重量。
 */
function SubSectionHeading(props: React.ComponentPropsWithoutRef<"h3">) {
  return <h3 className="mb-2 mt-4 text-[15px] font-bold text-ink" {...props} />;
}

/** 读出表格第一行（表头）每个单元格的文字。 */
function headerCellTexts(children: React.ReactNode): string[] {
  const head = React.Children.toArray(children)[0];
  if (!React.isValidElement(head)) return [];
  const row = React.Children.toArray((head.props as { children?: React.ReactNode }).children)[0];
  if (!React.isValidElement(row)) return [];
  return React.Children.toArray((row.props as { children?: React.ReactNode }).children).map((cell) =>
    textOf(cellChildren(cell)).trim(),
  );
}

/**
 * 表格的行渲染：
 * - 词卡表：字段行合并成整行；
 * - 学习目标表：把隐藏的空表头行换成跨列居中的标题行。
 */
function TableRow({ children, ...rest }: React.ComponentPropsWithoutRef<"tr">) {
  const { template, moduleTitle } = React.useContext(TableTemplateContext);
  const cells = React.Children.toArray(children);

  if (template === "objectives") {
    // 空表头行 → 标题行。成稿里「学习目标」是表格首行，不是表外的标题。
    const isHeaderRow = cells.every((cell) => textOf(cellChildren(cell)).trim() === "");
    if (!isHeaderRow || !moduleTitle) return <tr {...rest}>{children}</tr>;
    return (
      <tr data-table-title={moduleTitle} {...rest}>
        <th
          colSpan={2}
          className="border border-ink-3/45 px-3 py-2 text-center text-[22px] font-normal text-ink"
        >
          {moduleTitle}
        </th>
      </tr>
    );
  }

  if (template !== "word-card") return <tr {...rest}>{children}</tr>;
  if (cells.length < 4) return <tr {...rest}>{children}</tr>;
  if (textOf(cellChildren(cells[0])).trim() === VOCAB_CARD_HEADER[0]) {
    return <tr {...rest}>{children}</tr>;
  }

  const texts = cells.map((cell) => textOf(cellChildren(cell)).trim());
  const field = readWordCardField(texts);
  if (!field) return <tr {...rest}>{children}</tr>;
  // 正常形状直接用节点渲染，保留取值里的行内标记；损坏形状只剩纯文本可用。
  const value = texts[1] ? cellChildren(cells[1]) : field.value;
  return <MergedFieldRow label={field.label} value={value} rest={rest} />;
}

/**
 * 合并成整行的字段行。
 *
 * `data-field` 是给失焦回写用的：合并单元格在 DOM 里只有一个 `<td>`，
 * turndown 无法知道它原本是「字段名 + 取值」两列，靠这个属性还原。
 */
function MergedFieldRow({
  label,
  value,
  rest,
}: {
  label: string;
  value: React.ReactNode;
  rest: React.ComponentPropsWithoutRef<"tr">;
}) {
  return (
    <tr {...rest}>
      <td
        colSpan={4}
        data-field={label}
        className="border border-ink-3/45 px-3 py-1.5 align-top [overflow-wrap:anywhere]"
      >
        <strong className="font-bold">{label}</strong>：{value}
      </td>
    </tr>
  );
}

/**
 * 把生成的 Markdown 渲染成公司协作文档里的知识清单样式：
 * 宋体正文、细边框表格、字段名列带底色，词卡的字段行合并成整行。
 */
export function MarkdownContent({
  content,
  bookType,
  moduleKey,
  moduleTitle,
  highlightQuote,
}: MarkdownContentProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 高亮：在渲染结果里找含该片段的文本节点，套一层 <mark> 并滚过去。
  // 改的是 DOM 而不是 React 树（渲染是只读展示，不参与回写），
  // 每次片段变化前先撤掉上一次的高亮。
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const mark of [...root.querySelectorAll("mark[data-review-highlight]")]) {
      mark.replaceWith(...mark.childNodes);
    }
    const needle = highlightQuote?.trim();
    if (!needle) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue ?? "";
      const index = text.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        const mark = document.createElement("mark");
        mark.dataset.reviewHighlight = "1";
        mark.className = "rounded-[2px] bg-amber-200/70 ring-1 ring-amber-400/60";
        try {
          range.surroundContents(mark);
        } catch {
          // 片段跨了节点（如跨加粗边界）→ 退化成不高亮，但依然滚到那段文字
          mark.remove();
        }
        (mark.isConnected ? mark : node.parentElement)?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
        return;
      }
      node = walker.nextNode();
    }
  }, [highlightQuote, content]);

  return (
    <div ref={rootRef} className="knowledge-doc max-w-full text-[15px] leading-7 text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题层级只有两级：模块标题（`# 1. Let's say!`）是标题 1，其下设小节一律标题 2。
          // 模型可能把小节写成 `###`、`####`，这里统一成同一个层级，和导出件的大纲一致。
          h1: (props) => (
            <h1 className="mb-4 mt-0 text-[22px] font-bold tracking-tight text-ink" {...props} />
          ),
          h2: SectionHeading,
          h3: SubSectionHeading,
          h4: SubSectionHeading,
          h5: SubSectionHeading,
          h6: SubSectionHeading,
          p: (props) => <p className="my-2 break-words" {...props} />,
          strong: (props) => <strong className="font-bold text-ink" {...props} />,
          em: (props) => <em className="italic text-ink-2" {...props} />,
          ul: (props) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
          li: (props) => <li className="break-words leading-7" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="my-3 rounded-md border border-brand/15 bg-brand-tint/40 px-4 py-2 text-ink"
              {...props}
            />
          ),
          table: ({ children, ...props }) => {
            const template = resolveTableTemplate({ bookType, moduleKey }, headerCellTexts(children));
            return (
              <table
                className={cn(
                  // table-fixed + 单元格断词：长内容换行，不会把表格撑出面板。
                  "my-3 w-full table-fixed border-collapse text-[14px] leading-6",
                  template === "objectives" &&
                    "[&_td:first-child]:w-[92px] [&_td:first-child]:whitespace-nowrap [&_td:first-child]:text-[#0070C0]",
                  // 词卡由表头形状识别（见 table-templates），与所在模块无关——
                  // 列宽和字段行合并必须用同一个判据，否则会出现「合并了但没列宽」。
                  template === "word-card" && WORD_CARD_COLUMNS,
                )}
                {...props}
              >
                <TableTemplateContext.Provider value={{ template, moduleTitle }}>
                  {children}
                </TableTemplateContext.Provider>
              </table>
            );
          },
          th: (props) => (
            <th
              className="border border-ink-3/45 bg-[#f2f2f2] px-3 py-1.5 text-left font-bold text-ink [overflow-wrap:anywhere]"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="border border-ink-3/45 px-3 py-1.5 align-top [overflow-wrap:anywhere]"
              {...props}
            />
          ),
          tr: TableRow,
          hr: (props) => <hr className="my-4 border-line" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
