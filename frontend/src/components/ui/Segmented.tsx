import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** 몇 개 중 하나를 고르는 버튼 묶음 (라디오 그룹 의미) */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-lg border border-border bg-bg p-0.5", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition",
            size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
            value === o.value ? "bg-surface-2 text-text shadow-card ring-1 ring-border" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
