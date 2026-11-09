import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api, type Friend, type Hero, type Player, type PlayerInput, type StatFilters, type TrendSince } from "../lib/api";
import { localPlayers } from "../lib/localPlayers";

const apiLang = (lng: string) => (lng.startsWith("ko") ? "ko" : "en");

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    // 서버가 수집 중이면 자주, 아니면 가끔 상태를 확인해 새 데이터를 반영한다
    refetchInterval: (q) => (q.state.data?.collecting ? 5_000 : 60_000),
  });
}

export function useHeroes() {
  const { i18n } = useTranslation();
  const lang = apiLang(i18n.language);
  const q = useQuery({ queryKey: ["heroes", lang], queryFn: () => api.heroes(lang), staleTime: Infinity });
  const byId = useMemo(() => new Map<string, Hero>((q.data ?? []).map((h) => [h.hero_id, h])), [q.data]);
  return { ...q, heroes: q.data ?? [], byId };
}

export function useMaps(filters: StatFilters) {
  const { i18n } = useTranslation();
  const lang = apiLang(i18n.language);
  return useQuery({
    queryKey: ["maps", lang, filters],
    queryFn: () => api.maps(lang, filters),
    placeholderData: keepPreviousData,
  });
}

export function useMeta(filters: StatFilters, map: string) {
  return useQuery({
    queryKey: ["meta", filters, map],
    queryFn: () => api.meta(filters, map),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useTrends(filters: StatFilters, map: string, since: TrendSince = "prev") {
  return useQuery({
    queryKey: ["trends", filters, map, since],
    queryFn: () => api.trends(filters, map, since),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** 로그인한 회원 (비회원이면 null) */
export function useAccount() {
  const q = useQuery({ queryKey: ["account"], queryFn: api.me, staleTime: Infinity, retry: false });
  return { ...q, account: q.data ?? null };
}

/** 친구 목록과 요청 (회원만). 친구가 프로필을 고치면 다시 열 때 반영된다 */
export function useFriends() {
  const { account } = useAccount();
  const q = useQuery({
    queryKey: ["friends", account?.id],
    queryFn: api.friends,
    enabled: !!account,
    refetchOnWindowFocus: true,
  });
  return { ...q, friends: q.data?.friends ?? [], incoming: q.data?.incoming ?? [], outgoing: q.data?.outgoing ?? [] };
}

/**
 * 친구를 파티원 후보로: 그 사람의 '나' 프로필을 읽기 전용 플레이어로.
 * 이름은 그 프로필의 이름(게임 닉네임)을 쓴다. 데스크톱 앱이 점수판의 이름과 맞춰 보는 것이 이 이름과 부계정 닉네임이다
 */
export const friendAsPlayer = (f: Friend): Player => ({
  id: -f.user_id,
  name: f.profile?.name.trim() || f.username,
  aliases: f.profile?.aliases ?? [],
  is_me: false,
  preferred_roles: f.profile?.preferred_roles ?? [],
  heroes: f.profile?.heroes ?? [],
  only_preferred: f.profile?.only_preferred ?? false,
  friend: true,
});

/** 플레이어 프로필: 회원은 서버(+친구), 비회원은 이 브라우저 */
export function usePlayers() {
  const { account, isFetched } = useAccount();
  const owner = account ? account.id : "guest";
  const q = useQuery({
    queryKey: ["players", owner],
    queryFn: () => (account ? api.players() : Promise.resolve(localPlayers.list())),
    enabled: isFetched,
  });
  const friends = useFriends();
  const players = useMemo(
    () => [...(q.data ?? []), ...(account ? friends.friends.map(friendAsPlayer) : [])],
    [q.data, friends.friends, account],
  );
  // 친구까지 받아 온 뒤에 준비된 것으로 본다 (먼저 '준비'라고 하면 판에 있던 친구가 지워진다)
  const friendsDone = !account || friends.isFetched;
  return {
    ...q,
    isSuccess: q.isSuccess && friendsDone,
    isFetched: q.isFetched && friendsDone,
    players,
    me: players.find((p) => p.is_me) ?? null,
    guest: !account,
  };
}

/** 친구 요청·받기·끊기 */
export function useFriendActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["friends"] });
  return {
    request: useMutation({ mutationFn: api.requestFriend, onSuccess: done }),
    accept: useMutation({ mutationFn: api.acceptFriend, onSuccess: done }),
    remove: useMutation({ mutationFn: api.removeFriend, onSuccess: done }),
  };
}

export function useSavePlayer() {
  const qc = useQueryClient();
  const { account } = useAccount();
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: PlayerInput }) =>
      account ? (id ? api.updatePlayer(id, data) : api.createPlayer(data)) : localPlayers.save(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players"] }),
  });
}

export function useDeletePlayer() {
  const qc = useQueryClient();
  const { account } = useAccount();
  return useMutation({
    mutationFn: async (id: number) => (account ? api.deletePlayer(id) : localPlayers.remove(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players"] }),
  });
}

/**
 * 로그인·가입. 성공하면 계정이 비어 있을 때 이 브라우저의 비회원 프로필을 계정으로 옮긴다
 * (브라우저 쪽 사본은 로그아웃했을 때 쓰도록 그대로 둔다). 옮긴 개수를 돌려준다.
 */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      mode,
      username,
      password,
      website = "",
      recoveryCode = "",
    }: {
      mode: "login" | "signup" | "recover";
      username: string;
      password: string;
      website?: string;
      recoveryCode?: string;
    }) => {
      const res =
        mode === "login"
          ? await api.login(username, password)
          : mode === "signup"
            ? await api.signup(username, password, website)
            : await api.recover(username, recoveryCode, password);
      const account = { id: res.id, username: res.username };
      // 가입·복구 때만 받는다. 화면에 한 번 보여 주고 버린다
      const newRecoveryCode = "recovery_code" in res ? (res.recovery_code as string) : null;
      let imported = 0;
      const local = localPlayers.list();
      if (local.length && !(await api.players()).length) {
        for (const p of local) {
          await api.createPlayer({
            name: p.name,
            aliases: p.aliases ?? [],
            is_me: p.is_me,
            preferred_roles: p.preferred_roles,
            heroes: p.heroes,
            only_preferred: p.only_preferred,
          });
          imported++;
        }
      }
      return { account, imported, recoveryCode: newRecoveryCode };
    },
    onSuccess: ({ account }) => {
      qc.setQueryData(["account"], account);
      qc.invalidateQueries({ queryKey: ["players"] });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.setQueryData(["account"], null);
      qc.removeQueries({ queryKey: ["players"] });
      qc.removeQueries({ queryKey: ["friends"] });
    },
  });
}

/** 모든 기기에서 로그아웃 (이 기기 포함) */
export function useLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logoutAll,
    onSuccess: () => {
      qc.setQueryData(["account"], null);
      qc.removeQueries({ queryKey: ["players"] });
      qc.removeQueries({ queryKey: ["friends"] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.deleteAccount(password),
    onSuccess: () => {
      qc.setQueryData(["account"], null);
      qc.removeQueries({ queryKey: ["players"] });
      qc.removeQueries({ queryKey: ["friends"] });
    },
  });
}

export function useHeroDetail(id: string, filters: StatFilters) {
  return useQuery({
    queryKey: ["hero-detail", id, filters],
    queryFn: () => api.heroDetail(id, filters),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useMapInsights(filters: StatFilters) {
  return useQuery({
    queryKey: ["map-insights", filters],
    queryFn: () => api.mapInsights(filters),
    placeholderData: keepPreviousData,
    retry: false,
  });
}
