import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Width = "wide" | "content" | "narrow" | "form";
type Gap = 3 | 4 | 6;

const WIDTH: Record<Width, string> = {
  /** 데이터 화면: Layout의 1800px 안을 그대로 쓴다 */
  wide: "w-full",
  /** 넓지만 한눈에 읽히는 화면 */
  content: "mx-auto w-full max-w-[1440px]",
  /** 설정처럼 짧은 화면 */
  narrow: "mx-auto w-full max-w-2xl",
  /** 로그인·계정처럼 폼만 있는 화면 */
  form: "mx-auto w-full max-w-md",
};

const GAP: Record<Gap, string> = { 3: "gap-3", 4: "gap-4", 6: "gap-6" };

/** 모든 화면의 바깥 상자. 폭과 세로 간격을 한 곳에서 정한다 */
export function Page({
  width = "wide",
  gap = 4,
  className,
  children,
}: {
  width?: Width;
  gap?: Gap;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("flex flex-col", WIDTH[width], GAP[gap], className)}>{children}</div>;
}

/** 화면 제목·설명·오른쪽 액션(필터 등). 로딩 중에도 그대로 둔다 */
export function PageHeader({
  title,
  lead,
  actions,
  className,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-bold">{title}</h1>
        {lead && <p className="text-sm text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-end gap-2">{actions}</div>}
    </div>
  );
}
