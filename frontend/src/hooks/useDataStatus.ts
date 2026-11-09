import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useConfig } from "./data";
import { usePrefs } from "./prefs";

const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 선택한 지역의 통계 상태. 수집은 서버가 알아서 하므로 화면은 상태만 보여준다.
 * 새 데이터가 들어오면(마지막 수집 시각이 바뀌면) 통계 캐시를 새로 받는다.
 */
export function useDataStatus() {
  const { query } = usePrefs();
  const qc = useQueryClient();
  const { data: config, dataUpdatedAt } = useConfig();
  const last = config?.last_collected[query.region] ?? null;
  const prev = useRef(last);

  useEffect(() => {
    if (prev.current !== last) {
      prev.current = last;
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "config" && q.queryKey[0] !== "players" });
    }
  }, [last, qc]);

  return {
    loaded: !!config,
    /** 이 지역 통계가 아직 한 번도 수집되지 않음 (서버가 준비 중) */
    preparing: !!config && !last,
    collecting: !!config?.collecting,
    lastCollected: last,
    // 렌더 중 Date.now()를 부르지 않도록, 설정을 받아 온 시각을 기준으로 판단한다
    stale: !!last && dataUpdatedAt - new Date(last).getTime() > STALE_MS,
  };
}
