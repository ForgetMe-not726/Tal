import Link from "next/link";
import { ArrowRight, ClipboardCheck, Database, FilePlus2 } from "lucide-react";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { RuleLibrary } from "@/components/console/RuleLibrary";
import { listRulesWithVersions } from "@/lib/rules/service";
import { FLOW_UNITS } from "@/lib/mock";
import { cn } from "@/lib/utils";

const ICONS = {
  make: FilePlus2,
  review: ClipboardCheck,
  retrieve: Database,
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
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              AI 教研自动化控制中心
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              教培 AI 教材自动化工作台 · 印前控制台
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink-2">
            <span className="size-2 rounded-full bg-reg" />
            系统就绪
          </span>
        </header>

        {/* 模块 A：流程单元库 */}
        <section className="mt-8">
          <h2 className="text-base font-semibold tracking-tight">流程单元库</h2>
          <p className="mt-0.5 text-sm text-ink-3">选择一个流程开始</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {FLOW_UNITS.map((unit) => {
              const Icon = ICONS[unit.id];
              const chip = ACCENT[unit.accent].chip;
              const inner = (
                <>
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-md",
                        chip,
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold leading-tight">
                        {unit.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-ink-2">
                        {unit.desc}
                      </p>
                    </div>
                  </div>
                  {unit.href ? (
                    <span className="mt-5 flex items-center gap-1 text-sm font-medium text-brand-deep">
                      进入工作台
                      <ArrowRight className="size-4" />
                    </span>
                  ) : (
                    <span className="mt-5 inline-flex w-fit items-center rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                      即将接入
                    </span>
                  )}
                </>
              );

              const cardCls =
                "flex flex-col rounded-lg border border-line bg-paper p-5 shadow-sm transition-all";

              return unit.href ? (
                <Link
                  key={unit.id}
                  href={unit.href}
                  className={cn(
                    cardCls,
                    "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md",
                  )}
                >
                  {inner}
                </Link>
              ) : (
                <div key={unit.id} className={cardCls}>
                  {inner}
                </div>
              );
            })}
          </div>
        </section>

        {/* 模块 B：通用助手（只读检索，DESIGN §193-199） */}
        <div className="mt-10">
          <AssistantPanel />
        </div>

        {/* 模块 C：规则库管理（灰箱接口） */}
        <section className="mt-10">
          <h2 className="text-base font-semibold tracking-tight">规则库管理</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            灰箱接口 · 修改规则文件会改变 AI 的生成行为
          </p>
          <RuleLibrary initialRules={initialRules} initialError={initialError} />
        </section>
      </div>
    </div>
  );
}
