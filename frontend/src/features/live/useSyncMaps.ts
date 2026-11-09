import { useEffect } from "react";
import type { MapInfo } from "../../lib/api";
import { invoke, isDesktop } from "../../lib/platform";

/** Map id + localized name, so the bundled OCR can read the map text and pick the right map. */
export function useSyncMaps(maps: MapInfo[], ready: boolean) {
  const key = maps.map((m) => `${m.map_id}:${m.name}`).join("|");
  useEffect(() => {
    if (!isDesktop || !ready) return;
    invoke("live_set_maps", {
      maps: maps.map((m) => ({ id: m.map_id, name: m.name })),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
}
