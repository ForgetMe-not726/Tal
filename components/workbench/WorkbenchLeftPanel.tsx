"use client";

import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOOK_TYPES, LEVELS } from "@/lib/mock";
import type { BookTypeId, Level } from "@/lib/types";

interface Props {
  level: Level;
  bookType: BookTypeId;
  plateCount: number;
  totalPlates: number;
  onLevelChange: (l: Level) => void;
  onBookTypeChange: (b: BookTypeId) => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

export function WorkbenchLeftPanel({
  level,
  bookType,
  plateCount,
  totalPlates,
  onLevelChange,
  onBookTypeChange,
}: Props) {
  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-paper">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">教材参数配置</h2>
        <p className="mt-0.5 font-mono text-[11px] text-ink-3">印前参数</p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="space-y-1.5">
          <label htmlFor="level" className="text-xs font-medium text-ink-2">
            层级
          </label>
          <Select value={level} onValueChange={(v) => onLevelChange(v as Level)}>
            <SelectTrigger id="level" className="w-full">
              <SelectValue placeholder="选择层级" />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bookType" className="text-xs font-medium text-ink-2">
            书种
          </label>
          <Select
            value={bookType}
            onValueChange={(v) => onBookTypeChange(v as BookTypeId)}
          >
            <SelectTrigger id="bookType" className="w-full">
              <SelectValue placeholder="选择书种" />
            </SelectTrigger>
            <SelectContent>
              {BOOK_TYPES.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="flex-1 px-4 py-4">
        <p className="mb-3 text-xs font-medium text-ink-2">印刷工单</p>
        <dl className="space-y-2 font-mono text-xs">
          <Field label="层级" value={level} />
          <Field
            label="书种"
            value={BOOK_TYPES.find((b) => b.id === bookType)?.label ?? ""}
          />
          <Field label="版式" value="A4 · 单栏" />
          <Field label="印次" value="初印 · 01" />
          <Field label="出片" value="2026-08-25" />
          <Field label="色版" value={`${plateCount} / ${totalPlates}`} />
        </dl>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[11px] leading-relaxed text-ink-3">
          切换书种会联动右侧模块列表。
        </p>
      </div>
    </aside>
  );
}
