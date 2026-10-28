import Link from "next/link";
import { ArrowRight, ClipboardCheck, FilePlus2, ScanText } from "lucide-react";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { RuleLibrary } from "@/components/console/RuleLibrary";
import { listRulesWithVersions } from "@/lib/rules/service";
import { FLOW_UNITS } from "@/lib/mock";
import { cn } from "@/lib/utils";

// 首页要读当前工作区的规则；不能在构建时预渲染——那会把规则快照烤进静态页，
// 也会让 `next build` 去创建/迁移用户的工作区。
export const dynamic = "force-dynamic";

const ICONS = {
  recognize: ScanText,
  make: FilePlus2,
  review: ClipboardCheck,
} as const;

const ACCENT = {
  brand: { chip: "bg-brand-tint text-brand" },
  spot: { chip: "bg-spot-tint text-[#b45309]" },
  neutral: { chip: "bg-canvas-deep text-ink-2" },
} as const;

export default async function Home() {
  type Rules = Awaited<ReturnType<typeof listRulesWithVersions>>;
  let initialRules: Rules | null = null;
  let initialError: string | null = null;
  try {
    initialRules = await listRulesWithVersions();
  } catch (error) {
    initialError = (error as Error).message;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">AI 教研自动化工作台</h1>

        {/* 三项并列的生产能力；卡片本身就是入口，不再重复“进入工作台” */}
        <section className="mt-7 grid gap-4 sm:grid-cols-3" aria-label="生产能力">
          {FLOW_UNITS.map((unit) => {
            const Icon = ICONS[unit.id];
            return (
              <Link
                key={unit.id}
                href={unit.href ?? "/"}
                className="group flex items-start gap-3 rounded-lg border border-line bg-paper p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-md",
                    ACCENT[unit.accent].chip,
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-tight">{unit.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-2">{unit.desc}</span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            );
          })}
        </section>

        <div className="mt-10">
          <AssistantPanel />
        </div>

        <section className="mt-10">
          <h2 className="text-base font-semibold tracking-tight">规则库</h2>
          <RuleLibrary initialRules={initialRules} initialError={initialError} />
        </section>
      </div>
    </div>
  );
}
