import { useTranslation } from "react-i18next";
import { useConfig, useMaps } from "../hooks/data";
import { usePrefs } from "../hooks/prefs";
import { QUICK, type Region } from "../lib/api";
import { MapPicker } from "./MapPicker";
import { RankPicker } from "./RankPicker";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";

/** 통계 조건(지역, 모드, 등급)과 전장 선택. 픽·티어·변동 화면이 같이 쓴다. */
export function FilterBar({ showMap = true }: { showMap?: boolean }) {
  const { t } = useTranslation();
  const { filters, setFilters, query, map, setMap } = usePrefs();
  const config = useConfig().data;
  const maps = useMaps(query).data ?? [];
  const quick = filters.rq === QUICK;


  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t("filters.region")}
        value={filters.region}
        onChange={(e) => setFilters({ ...filters, region: e.target.value as Region })}
      >
        {(config?.regions ?? ["korea"]).map((r) => (
          <option key={r} value={r}>
            {t(`regions.${r}`)}
          </option>
        ))}
      </Select>
      <Segmented
        label={t("filters.mode")}
        value={filters.rq}
        onChange={(rq) => setFilters({ ...filters, rq })}
        options={[
          { value: config?.modes.competitive ?? "2", label: t("filters.competitive") },
          { value: config?.modes.quick ?? QUICK, label: t("filters.quick") },
        ]}
      />
      {/* 빠른 대전은 등급이 없다. 숨기면 필터 줄이 옆으로 밀리므로 자리는 두고 비활성화 */}
      <RankPicker
        ranks={config?.ranks ?? ["all"]}
        value={filters.rank}
        onChange={(rank) => setFilters({ ...filters, rank })}
        disabled={quick}
        disabledLabel={t("filters.noRank")}
        disabledTitle={t("filters.noRankInQuick")}
      />
      {showMap && <MapPicker maps={maps} value={map} onChange={setMap} />}
    </div>
  );
}
