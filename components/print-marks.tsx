import { cn } from "@/lib/utils";
import type { PlateTone } from "@/lib/types";

/** 套准十字：圆环 + 十字刻度，出版排样台的标志性标记 */
export function RegistrationMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 0v2.5M8 13.5V16M0 8h2.5M13.5 8H16" />
    </svg>
  );
}

/** 裁切线：A4 拼版纸四角的 L 形标记 */
export function CropMarks({ className }: { className?: string }) {
  const base = "absolute h-3 w-3 border-ink-3/70";
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      <span className={cn(base, "-left-2 -top-2 border-l border-t")} />
      <span className={cn(base, "-right-2 -top-2 border-r border-t")} />
      <span className={cn(base, "-bottom-2 -left-2 border-b border-l")} />
      <span className={cn(base, "-bottom-2 -right-2 border-b border-r")} />
    </div>
  );
}

const FILLED_TONE: Record<PlateTone, string> = {
  brand: "border-brand bg-brand text-white",
  spot: "border-spot bg-spot text-white",
  reg: "border-reg bg-reg text-white",
  violet: "border-violet bg-violet text-white",
};

/** 色版块：按油墨（青版/专色/墨黑）着色的方块 + 版号字母 */
export function PlateSwatch({
  letter,
  filled,
  tone = "brand",
  className,
}: {
  letter: string;
  filled?: boolean;
  tone?: PlateTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-[3px] border text-[10px] font-semibold leading-none",
        filled ? FILLED_TONE[tone] : "border-line bg-paper text-ink-3",
        className,
      )}
    >
      {letter}
    </span>
  );
}
