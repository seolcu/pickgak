import { useEffect } from "react";
import { invoke } from "../../lib/platform";
import type { Player } from "../../lib/api";
import { isDesktop } from "../../lib/platform";

/** Players 탭의 이름(부계정 닉네임 포함) 목록을 데스크톱 앱에 넘긴다. 이름 질문의 후보는 이 목록 안에서만 고른다 */
export function useSyncPlayers(players: Player[], ready: boolean) {
  const key = players.map((p) => `${p.id}:${p.name}:${(p.aliases ?? []).join(",")}:${p.is_me ? 1 : 0}`).join("|");
  useEffect(() => {
    if (!isDesktop || !ready) return;
    invoke("live_set_players", {
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases ?? [],
        me: p.is_me,
      })),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
}
