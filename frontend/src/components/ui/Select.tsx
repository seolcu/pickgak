import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

/** 네이티브 select를 감싼 것. 모바일에서 OS 기본 선택 UI가 떠서 쓰기 편하다. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        className="h-9 w-full appearance-none rounded-lg border border-border bg-surface pr-8 pl-3 text-sm font-medium hover:bg-surface-2"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
