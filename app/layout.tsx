import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GlobalSidebar } from "@/components/GlobalSidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "AI 教研自动化控制中心",
  description: "教培 AI 教材自动化工作台",
};

export const viewport: Viewport = {
  themeColor: "#14181c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full antialiased">
        <span
          aria-hidden="true"
          hidden
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: 教材工作台是一张印前拼版纸——配置与规则是印前参数，模块是油墨色版，正文是落墨的排样；拒绝通用 SaaS 的卡片网格。
OWN-WORLD: 墨色系（青版 #0083BB、专色橙 #EC8F04、墨黑、暖纸白），工具 chrome 冷灰拷贝台；正文宋体 serif、工具无衬线 + 工单等宽标签；细发丝裁切线与套准十字。
STORY: 教研人员明白自己在"排版/上墨"——选参数、点模块、看正文落墨累积，套准变绿表示对齐规则，可导出成品。
FIRST VIEWPORT: 三栏拼版台：左 240px 印前参数（层级/书种），右 280px 色版/模块，中自适应 A4 拼版纸带裁切+套准+色标条，工具栏置顶。
FORM: 出版排样台（grounded #7），seed f45dde4d。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`,
          }}
        />
        <TooltipProvider delayDuration={200}>
          <div className="flex h-full min-h-screen">
            <GlobalSidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
