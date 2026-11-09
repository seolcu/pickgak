import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";
import { apiAsset } from "../lib/platform";
import { rankLabel } from "../lib/ranks";

/** 등급 엠블럼. 'all'(모든 등급)은 겹친 층 아이콘, 합친 등급은 가장 낮은·높은 등급 엠블럼 둘 */
export function RankEmblem({ rank, className }: { rank: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const parts = rank.split("+");
  if (parts.length > 1)
    return (
      // 엠블럼마다 받은 크기를 그대로 쓰고 조금만 겹친다. 둘을 한 칸 크기에 넣으면 옆 글자를 덮는다
      <span className="inline-flex shrink-0 items-center" aria-hidden>
        <RankEmblem rank={parts[0]} className={cn("shrink-0", className)} />
        <RankEmblem rank={parts[parts.length - 1]} className={cn("-ml-2 shrink-0", className)} />
      </span>
    );
  if (rank === "all" || failed)
    return (
      <span className={cn("inline-flex items-center justify-center text-muted", className)} aria-hidden>
        <Layers className="size-[70%]" />
      </span>
    );
  return (
    <img
      src={apiAsset(`/ranks/${rank}/image`)}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
    />
  );
}

/** 등급 선택: 엠블럼 그리드. 빠른 대전처럼 등급이 없으면 자리는 그대로 두고 비활성 */
export function RankPicker({
  ranks,
  value,
  onChange,
  disabled,
  disabledLabel,
  disabledTitle,
}: {
  ranks: string[];
  value: string;
  onChange: (r: string) => void;
  disabled?: boolean;
  disabledLabel?: string;
  disabledTitle?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = disabled ? "all" : value;

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("filters.rank")}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          className="inline-flex h-9 min-w-36 items-center gap-2 rounded-lg border border-border bg-surface pr-2 pl-1.5 text-sm font-medium hover:bg-surface-2 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-surface"
        >
          <RankEmblem rank={shown} className="size-7" />
          <span className="flex-1 truncate text-left">{disabled ? disabledLabel : rankLabel(value, t)}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 grid w-[min(92vw,420px)] grid-cols-3 gap-1.5 rounded-xl border border-border bg-surface p-2 shadow-card"
        >
          {ranks.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === value}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium transition",
                r === value ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2",
              )}
            >
              <RankEmblem rank={r} className="size-12" />
              {t(`ranks.${r}`)}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
