import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo } from "react";
import { api, type Player, type StatFilters } from "../../lib/api";
import { isAutoRole, onlyPreferredFor, threatHeroes, type Board, type Person, type Slot } from "./board";

export interface Member {
  slot: Slot;
  player: Player | null;
}

/**
 * 판 상태를 추천 요청으로 바꾼다.
 * - 파티원은 영웅을 골랐든 안 골랐든 모두 개인/파티 추천 대상이다. 영웅을 정했다고 고정하지 않는다
 *   (파티원이 말을 듣고 픽을 바꿀 수 있으니, 현재 픽은 참고일 뿐이다).
 * - 파티 조합 요청의 고정 아군은 파티가 아닌 랜덤 팀원의 현재 영웅뿐이다.
 * - 개인 추천은 지금 판의 아군(파티원의 현재 픽 포함)을 상대로 "나"에게 맞춘다.
 */
export function buildRequest(
  board: Board,
  players: Player[],
  me: Player | null,
  filters: StatFilters,
  map: string,
  bansActive: boolean,
) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const members: Member[] = board.allies
    .filter((s) => s.isMe || s.playerId !== null)
    .map((s) => ({ slot: s, player: s.isMe ? me : (byId.get(s.playerId!) ?? null) }));
  const memberIds = new Set(members.map((m) => m.slot.id));
  // 파티 조합: 파티원은 추천으로 정할 사람이라 고정 아군에서 뺀다
  const fixedAllies = board.allies.filter((s) => !memberIds.has(s.id) && s.hero).map((s) => s.hero!);
  // 개인 추천/밴: 지금 화면에 보이는 아군 구성을 그대로 쓴다 (파티원의 현재 픽 포함)
  const currentAllies = board.allies.filter((s) => !s.isMe && s.hero).map((s) => s.hero!);
  const enemies = board.enemies.filter((s) => s.hero).map((s) => s.hero!);
  const base = {
    ...filters,
    map,
    queue: board.queue,
    allies: fixedAllies,
    enemies,
    bans: bansActive ? board.bans : [],
    lobby_ban: bansActive && !!board.lobbyBan,
    threats: threatHeroes(board),
    preferred_only: false, // 사람별로 따로 보낸다
  };
  return { members, base, currentAllies };
}

const personOf = (s: Slot): Person => (s.isMe ? { kind: "me" } : { kind: "player", id: s.playerId! });

export function useRecommendations(
  board: Board,
  players: Player[],
  me: Player | null,
  filters: StatFilters,
  map: string,
  enabled: boolean,
  bansActive: boolean,
) {
  const { members, base, currentAllies } = useMemo(
    () => buildRequest(board, players, me, filters, map, bansActive),
    [board, players, me, filters, map, bansActive],
  );
  const party = members.length > 1;
  // 이번 판 역할: 역할 고정 큐는 슬롯 역할(‘자동’이면 null), 자유 큐는 사람마다 고른 역할(없으면 자동)
  const roleFor = (s: Slot) => (s.role === null ? (s.wantRole ?? null) : isAutoRole(board, personOf(s)) ? null : s.role);
  const mySlot = board.allies.find((s) => s.isMe) ?? null;

  // 개인 추천: 파티 여부와 상관없이 항상 "나"의 추천을 따로 계산한다
  const soloBody = useMemo(
    () => ({
      ...base,
      allies: currentAllies,
      role: mySlot ? roleFor(mySlot) : null,
      preferred: me?.heroes ?? [],
      preferred_only: onlyPreferredFor(board, { kind: "me" }, me),
      top: 6,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roleFor는 board에서만 파생
    [base, currentAllies, mySlot, me, board],
  );
  // 파티 조합: 현재 픽과 상관없이 파티원 모두에게 영웅을 제안한다
  const partyBody = useMemo(
    () => ({
      ...base,
      members: members.map((m) => ({
        key: m.slot.id,
        role: roleFor(m.slot),
        preferred: m.player?.heroes ?? [],
        preferred_roles: m.player?.preferred_roles ?? [],
        preferred_only: onlyPreferredFor(board, personOf(m.slot), m.player),
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roleFor는 board에서만 파생
    [base, members, board],
  );
  // 우리가 지키고 싶은 영웅 = 나와 파티원의 선호 영웅 (밴 추천에서 빼고, 이들을 카운터하는 영웅을 올린다)
  const banBody = useMemo(
    () => ({
      ...base,
      allies: currentAllies,
      // 나·파티원 선호 영웅 + 파티가 아닌 아군이 하려는 영웅
      protect: [...new Set([...members.flatMap((m) => m.player?.heroes ?? []), ...(board.allyWants ?? [])])],
      // 파티 인원(나 + 파티원 자리, 영웅을 이미 골랐어도 포함): 적을수록 표가 모일 영웅(밴률)을 중시
      party_size: board.allies.filter((s) => s.isMe || s.playerId !== null).length,
      top: 10,
    }),
    [base, currentAllies, members, board.allyWants, board.allies],
  );
  // 빠르게 여러 번 바꿀 때 요청이 쌓이지 않도록 렌더 우선순위를 낮춘다
  const deferredSolo = useDeferredValue(soloBody);
  const deferredParty = useDeferredValue(partyBody);
  const deferredBan = useDeferredValue(banBody);

  const solo = useQuery({
    queryKey: ["recommend", deferredSolo],
    queryFn: () => api.recommend(deferredSolo as Parameters<typeof api.recommend>[0]),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const partyQ = useQuery({
    queryKey: ["party", deferredParty],
    queryFn: () => api.party(deferredParty as Parameters<typeof api.party>[0]),
    enabled: enabled && party,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const bans = useQuery({
    queryKey: ["bans", deferredBan],
    queryFn: () => api.bans(deferredBan),
    enabled: enabled && bansActive,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { members, party, solo, partyQ, bans };
}
