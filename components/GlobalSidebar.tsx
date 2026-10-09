"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FolderCog, NotebookPen, ScanText, ShieldCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RegistrationMark } from "@/components/print-marks";
import { cn } from "@/lib/utils";

/**
 * 一级导航。顺序按 DESIGN.md 固定为
 * 「资料识别 / 教材制作 / 教材审校 / 本地资料库 / 设置」。
 *
 * 还没实现的项**显示"准备中"**，不伪装成已完成（DESIGN.md 明确要求）；
 * 主页从左上角的套准十字进（它是品牌位，也避免首页占掉一个生产入口）。
 */
const NAV = [
  { href: "/recognize", label: "资料识别", icon: ScanText, ready: true },
  { href: "/workbench", label: "教材制作", icon: NotebookPen, ready: true },
  { href: "/review", label: "教材审校", icon: ShieldCheck, ready: true },
  { href: "/library", label: "本地资料库", icon: BookMarked, ready: false },
  { href: "/settings", label: "设置", icon: FolderCog, ready: false },
];

export function GlobalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-1 border-r border-black/20 bg-chrome py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            aria-label="主页"
            aria-current={pathname === "/" ? "page" : undefined}
            className={cn(
              "mb-2 flex size-9 items-center justify-center rounded-md transition-colors",
              pathname === "/" ? "bg-chrome-2 text-brand" : "bg-chrome-2 text-brand hover:text-paper",
            )}
          >
            <RegistrationMark className="size-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">主页</TooltipContent>
      </Tooltip>

      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ href, label, icon: Icon, ready }) => {
          const active = pathname.startsWith(href);
          const content = (
            <>
              <Icon className="size-5" />
            </>
          );
          if (!ready) {
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <span
                    aria-label={`${label}（准备中）`}
                    aria-disabled="true"
                    className="flex size-10 cursor-not-allowed items-center justify-center rounded-md text-ink-3/50"
                  >
                    {content}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{label} · 准备中</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <Tooltip key={href}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-md transition-colors",
                    active
                      ? "bg-chrome-2 text-brand"
                      : "text-ink-3 hover:bg-chrome-2 hover:text-paper",
                  )}
                >
                  {content}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
