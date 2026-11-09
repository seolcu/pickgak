import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Card } from "./misc";

/**
 * 카드 안의 한 묶음. 제목·힌트·아이콘·패딩을 한 곳에서 정한다.
 * `sm`은 대시보드처럼 한 화면에 여러 개가 들어가는 카드에 쓴다.
 */
export function SectionCard({
  title,
  hint,
  icon,
  actions,
  size = "md",
  className,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
}) {
  const small = size === "sm";
  return (
    <Card className={cn("flex flex-col", small ? "gap-2 p-3" : "gap-3 p-4", className)}>
      {(title || actions) && (
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className={cn("flex items-center gap-2 font-semibold", small && "text-sm")}>
              {icon && <span className="shrink-0 text-muted [&_svg]:size-4">{icon}</span>}
              {title}
            </h2>
            {hint && <p className={cn("text-muted", small ? "text-[11px]" : "text-xs")}>{hint}</p>}
          </div>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}
