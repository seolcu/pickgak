import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "accent" | "solid" | "good" | "bad" | "ally" | "enemy" | "muted";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text",
  accent: "bg-accent-soft text-accent",
  solid: "bg-accent text-accent-fg",
  good: "bg-good/15 text-good",
  bad: "bg-bad/15 text-bad",
  ally: "bg-ally-soft text-ally",
  enemy: "bg-enemy-soft text-enemy",
  muted: "bg-surface-2 text-muted",
};

/** 작은 상태 표시 (내 자리, 선호 전용, 추천 이유 등). 알약 모양이 필요하면 `pill` */
export function Badge({
  tone = "neutral",
  size = "sm",
  pill,
  className,
  children,
}: {
  tone?: Tone;
  size?: "xs" | "sm";
  pill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold whitespace-nowrap [&_svg]:size-3",
        size === "xs" ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]",
        pill ? "rounded-full" : "rounded-md",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
