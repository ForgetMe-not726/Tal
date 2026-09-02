"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 将生成结果渲染为教材正文：宋体 serif，工具与产品字体分离 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="font-serif text-[15px] leading-7 text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h3: (props) => (
            <h3
              className="mb-4 mt-0 text-[17px] font-bold tracking-tight text-ink"
              {...props}
            />
          ),
          h4: (props) => (
            <h4 className="mb-2 mt-6 text-[15px] font-bold text-ink" {...props} />
          ),
          p: (props) => <p className="my-2" {...props} />,
          strong: (props) => (
            <strong className="font-bold text-ink" {...props} />
          ),
          em: (props) => <em className="italic text-ink-2" {...props} />,
          ul: (props) => (
            <ul className="my-2 list-disc space-y-1 pl-5" {...props} />
          ),
          ol: (props) => (
            <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />
          ),
          li: (props) => <li className="leading-7" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="my-3 rounded-md border border-brand/15 bg-brand-tint/40 px-4 py-2 text-ink"
              {...props}
            />
          ),
          table: (props) => (
            <table className="my-3 w-full border-collapse text-sm" {...props} />
          ),
          th: (props) => (
            <th
              className="border border-line bg-canvas px-3 py-1.5 text-left font-bold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border border-line px-3 py-1.5" {...props} />
          ),
          hr: (props) => <hr className="my-4 border-line" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
