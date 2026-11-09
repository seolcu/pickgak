import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** 화면 위에 붙는 한 줄 안내. 소개 배너와 업데이트 알림이 같은 모양을 쓴다 */
export function Banner({
  icon,
  title,
  actions,
  className,
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm",
        className,
      )}
    >
      {icon && <span className="shrink-0 text-accent [&_svg]:size-4">{icon}</span>}
      {title && <span className="font-semibold">{title}</span>}
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}
