"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, NotebookPen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RegistrationMark } from "@/components/print-marks";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "主页", icon: House },
  { href: "/workbench", label: "工作台", icon: NotebookPen },
];

export function GlobalSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-1 border-r border-black/20 bg-chrome py-3">
      <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-chrome-2 text-brand">
        <RegistrationMark className="size-4" />
      </div>

      <nav className="flex flex-col items-center gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
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
                  <Icon className="size-5" />
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
