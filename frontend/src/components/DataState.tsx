import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDataStatus } from "../hooks/useDataStatus";
import { ApiError } from "../lib/api";
import { Button } from "./ui/Button";
import { EmptyState, Skeleton } from "./ui/misc";

/** 통계가 없을 때의 안내. 서버가 처음 수집 중이면 '준비 중', 아니면 '이 조건엔 데이터 없음' */
export function NoDataState({ className }: { className?: string }) {
  const { t } = useTranslation();
  const status = useDataStatus();
  if (status.preparing || (status.collecting && !status.lastCollected))
    return (
      <EmptyState
        className={className}
        icon={<Loader2 className="animate-spin" />}
        title={t("data.preparing")}
        description={t("data.preparingHint")}
      />
    );
  return <EmptyState className={className} title={t("data.noData")} description={t("data.noDataHint")} />;
}

export const isNoData = (e: unknown) => e instanceof ApiError && e.code === "no_data";

/**
 * 한 화면의 로딩·데이터 없음·오류(다시 시도)·내용을 한 곳에서 처리한다.
 * 페이지 제목과 필터는 이 밖에 두어 로딩 중에도 사라지지 않게 한다.
 */
export function QueryState<T>({
  query,
  skeleton = "h-96",
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: string;
  /** 데이터는 왔지만 보여 줄 것이 없을 때 */
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (query.isPending) return <Skeleton className={skeleton} />;
  if (isNoData(query.error)) return <NoDataState />;
  if (query.error)
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title={t("errors.unknown")}
        description={t("data.retryHint")}
        action={
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className="size-4" />
            {t("data.retry")}
          </Button>
        }
      />
    );
  if (query.data === undefined) return <Skeleton className={skeleton} />;
  if (empty !== undefined) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/** 필터 줄 끝에 붙는 작은 상태 표시: 갱신 중 / 오래된 데이터 */
export function DataBadge() {
  const { t } = useTranslation();
  const status = useDataStatus();
  if (status.stale)
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-enemy-soft px-2 py-1 text-xs text-bad"
        title={t("data.staleHint")}
      >
        <AlertTriangle className="size-3.5" />
        {t("data.stale")}
      </span>
    );
  if (status.collecting)
    return (
      <span className="inline-flex items-center gap-1 px-1 text-xs text-muted" title={t("data.updatingHint")}>
        <RefreshCw className="size-3.5 animate-spin" />
        {t("data.updating")}
      </span>
    );
  return null;
}
