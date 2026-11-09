import { invoke, isDesktop } from "./platform";
export type Role = "tank" | "damage" | "support";
export const ROLES: Role[] = ["tank", "damage", "support"];
export type Tier = "S" | "A" | "B" | "C" | "D";
export type QueueId = "role_queue" | "open_queue" | "other";
export type Region = "korea" | "asia" | "americas" | "europe";
export const QUICK = "0";

export interface QueueConfig {
  team_size: number;
  slots: Record<Role, number> | null;
  stats_fallback: boolean;
  default: boolean;
}

export interface AppConfig {
  queues: Record<QueueId, QueueConfig>;
  modes: Record<"quick" | "competitive", string>;
  ranks: string[];
  roles: Role[];
  regions: Region[];
  bans: BanConfig;
  last_collected: Record<Region, string | null>;
  collecting: boolean;
}

export interface BanConfig {
  /** 밴이 있는 모드(rq) */
  modes: string[];
  per_team: number;
  lobby: number;
  total: number;
  max_per_role: number;
  votes: number[];
  high_ban_rate: number;
}

export interface Hero {
  hero_id: string;
  name: string;
  role: Role;
  subrole: string | null;
  color: string | null;
  thumbnail: string | null;
}

export interface MapInfo {
  map_id: string;
  name: string;
  mode: string;
  /** 현재 지역·모드·등급 조건에 통계가 있는지 */
  has_data: boolean;
}

export interface ScoredHero {
  hero_id: string;
  role: Role;
  win_rate: number;
  pick_rate: number;
  ban_rate: number | null;
  adj_win_rate: number;
  adj_pick_rate: number;
  meta_score: number;
  tier: Tier;
}

export type Reason =
  | { kind: "map"; win_rate: number; pick_rate: number; win_diff: number; tier: Tier }
  | { kind: "meta"; tier: Tier; win_rate: number; pick_rate: number }
  | { kind: "counter" | "countered"; enemy: string; strength?: number }
  | { kind: "synergy"; ally: string }
  | { kind: "preferred" }
  | { kind: "ban_risk"; ban_rate: number }
  | { kind: "threat_counter" | "threat_weak"; enemy: string }
  | { kind: "comp_fit" | "comp_counter"; comp: Comp }
  | { kind: "low_heal" | "double_main_dps" | "double_sub_dps" | "double_main_heal" | "weak_pair" };

/** 팀 조합 유형 */
export type Comp = "dive" | "poke" | "rush" | "anchor";
export interface TeamComps {
  allies: Comp | null;
  enemies: Comp | null;
}

export type BanReason =
  | { kind: "meta"; tier: Tier; win_rate: number; pick_rate: number }
  | { kind: "threatens"; hero: string }
  | { kind: "ban_rate"; ban_rate: number };

export interface BanRecommendation {
  hero_id: string;
  role: Role;
  tier: Tier;
  ban_rate: number;
  score: number;
  votes: number;
  parts: Record<string, number>;
  reasons: BanReason[];
}

export interface Recommendation {
  hero_id: string;
  role: Role;
  tier: Tier;
  score: number;
  parts: Record<string, number>;
  reasons: Reason[];
}

export interface PartyPick extends Recommendation {
  member: string;
}

export interface PartyCombo {
  score: number;
  picks: PartyPick[];
  synergies: [string, string][];
}

export interface TrendRow {
  hero_id: string;
  role: Role;
  win_rate: number;
  pick_rate: number;
  win_delta: number;
  pick_delta: number;
}

export type TrendSince = "prev" | "7d" | "30d";

export interface HeroDetail {
  fetched_at: string;
  summary: ScoredHero & { delta: { win: number; pick: number } | null };
  maps: { map_id: string; win_rate: number; pick_rate: number; win_diff: number; pick_ratio: number | null }[];
  modes: { mode: string; win_rate: number | null; maps: number }[];
  map_spread: { sigma: number | null; min: number | null; max: number | null };
  hidden_strong: { map_id: string; win_rate: number; win_diff: number; pick_ratio: number | null }[];
  ranks: { rank: string; win_rate: number | null; pick_rate: number | null; ban_rate: number | null }[];
  history: { at: string; win_rate: number | null; pick_rate: number | null; ban_rate: number | null }[];
  matchups: { strong_vs: string[]; weak_vs: string[]; synergy: string[] };
}

export interface MapSpecialist {
  hero_id: string;
  role: Role;
  pick_rate: number;
  win_rate: number;
  pick_ratio: number;
  win_diff: number;
}

export interface Player {
  id: number;
  name: string;
  /** 부계정 닉네임. 데스크톱 앱은 이름과 이 닉네임을 모두 점수판 이름과 맞춰 본다 */
  aliases?: string[];
  is_me: boolean;
  preferred_roles: Role[];
  heroes: string[];
  /** 이 사람은 선호 영웅만 한다 (기본값. 판마다 바꿀 수 있음) */
  only_preferred: boolean;
  /** 친구 계정의 '나' 프로필 (읽기 전용). id는 -회원 번호라 내 프로필 id와 겹치지 않는다 */
  friend?: boolean;
}

export type PlayerInput = Omit<Player, "id" | "friend">;

export interface FriendPerson {
  user_id: number;
  username: string;
}

export interface Friend extends FriendPerson {
  /** 친구의 '나' 프로필. 아직 만들지 않았으면 null */
  profile: Pick<Player, "name" | "aliases" | "preferred_roles" | "heroes" | "only_preferred"> | null;
}

export interface FriendList {
  friends: Friend[];
  incoming: FriendPerson[];
  outgoing: FriendPerson[];
}

/** 로그인한 회원 */
export interface Account {
  id: number;
  username: string;
}

/** 통계 조회 조건 (PC만 다룬다) */
export interface StatFilters {
  region: Region;
  rq: string;
  rank: string;
}

/** 빠른 대전은 등급이 없으므로 요청에는 항상 등급 합산을 보낸다 (화면의 등급 선택은 기억해 둠) */
export const effectiveFilters = (f: StatFilters): StatFilters => (f.rq === QUICK ? { ...f, rank: "all" } : f);

export interface SituationBody extends StatFilters {
  map: string;
  queue: QueueId;
  allies: string[];
  enemies: string[];
  bans: string[];
  preferred_only: boolean;
}

/** 백엔드가 돌려주는 번역 가능한 오류 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

/** 웹은 fetch, 데스크톱 앱은 Rust 쪽 호출. 결과는 (상태 코드, 본문) */
async function send(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  if (isDesktop) {
    const r = await invoke<{ status: number; body: string }>("api", {
      method: init?.method ?? "GET",
      path,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return { status: r.status, body: r.body ? JSON.parse(r.body) : null };
  }
  const res = await fetch(`/api${path}`, init);
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let status: number;
  let body: { detail?: unknown } | null;
  try {
    ({ status, body } = (await send(path, init)) as { status: number; body: { detail?: unknown } | null });
  } catch {
    throw new ApiError(0, "network");
  }
  if (status === 204) return undefined as T;
  if (status < 200 || status >= 300) {
    const detail = body?.detail;
    if (detail && typeof detail === "object" && "code" in detail) {
      const d = detail as { code: string; params?: Record<string, string | number> };
      throw new ApiError(status, d.code, d.params);
    }
    throw new ApiError(status, "unknown");
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** 데스크톱 앱 최신 버전 (서버가 내려주는 파일) */
export interface AppRelease {
  version: string;
  released: string;
  files: {
    name: string;
    kind: "rpm" | "deb" | "appimage" | "exe";
    os: "linux" | "windows";
    size: number;
    sha256: string | null;
  }[];
}

export const api = {
  config: () => request<AppConfig>("/config"),
  appLatest: () => request<AppRelease>("/app/latest"),
  heroes: (lang: string) => request<Hero[]>(`/heroes?lang=${lang}`),
  maps: (lang: string, f: StatFilters) => request<MapInfo[]>(`/maps?${qs({ lang, ...f })}`),
  meta: (f: StatFilters, map: string) =>
    request<{ fetched_at: string; heroes: ScoredHero[] }>(`/meta?${qs({ ...f, map })}`),
  trends: (f: StatFilters, map: string, since: TrendSince = "prev") =>
    request<{
      current: string;
      previous: string | null;
      changes: TrendRow[];
      series: Record<string, (number | null)[]>;
    }>(`/trends?${qs({ ...f, map, since })}`),
  heroDetail: (id: string, f: StatFilters) => request<HeroDetail>(`/heroes/${encodeURIComponent(id)}/detail?${qs({ ...f })}`),
  mapInsights: (f: StatFilters) =>
    request<{ maps: { map_id: string; fetched_at: string; specialists: MapSpecialist[] }[] }>(
      `/maps/insights?${qs({ ...f })}`,
    ),
  recommend: (body: SituationBody & { role: Role | null; preferred: string[]; top?: number }) =>
    request<{ map_has_data: boolean; stats_fallback: boolean; comps: TeamComps; recommendations: Recommendation[] }>(
      "/recommend",
      json("POST", body),
    ),
  party: (
    body: SituationBody & {
      members: {
        key: string;
        role: Role | null;
        preferred: string[];
        preferred_roles: Role[];
        preferred_only: boolean;
      }[];
    },
  ) =>
    request<{
      map_has_data: boolean;
      stats_fallback: boolean;
      comps: TeamComps;
      combos: PartyCombo[];
      alternatives: Record<string, Recommendation[]>;
    }>("/party", json("POST", body)),
  bans: (body: SituationBody & { protect: string[]; party_size: number; top?: number }) =>
    request<{
      map_has_data: boolean;
      weights: { party_size: number; team_size: number; popularity: number; threat: number };
      recommendations: BanRecommendation[];
    }>("/bans", json("POST", body)),
  me: () => request<Account | null>("/auth/me"),
  // website: 사람에게는 보이지 않는 칸(봇 걸러내기). 비어 있어야 한다
  signup: (username: string, password: string, website = "") =>
    request<Account & { recovery_code: string }>("/auth/signup", json("POST", { username, password, website })),
  recover: (username: string, recovery_code: string, new_password: string) =>
    request<Account & { recovery_code: string }>("/auth/recover", json("POST", { username, recovery_code, new_password })),
  changePassword: (current: string, next: string) =>
    request<void>("/auth/password", json("POST", { current, new: next })),
  logoutAll: () => request<void>("/auth/logout-all", { method: "POST" }),
  newRecoveryCode: (password: string) =>
    request<{ recovery_code: string }>("/auth/recovery-code", json("POST", { password })),
  login: (username: string, password: string) => request<Account>("/auth/login", json("POST", { username, password })),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  deleteAccount: (password: string) => request<void>("/auth/delete", json("POST", { password })),
  players: () => request<Player[]>("/players"),
  createPlayer: (p: PlayerInput) => request<Player>("/players", json("POST", p)),
  updatePlayer: (id: number, p: PlayerInput) => request<Player>(`/players/${id}`, json("PUT", p)),
  deletePlayer: (id: number) => request<void>(`/players/${id}`, { method: "DELETE" }),
  friends: () => request<FriendList>("/friends"),
  requestFriend: (username: string) =>
    request<{ status: "requested" | "accepted"; user_id: number; username: string }>(
      "/friends",
      json("POST", { username }),
    ),
  acceptFriend: (userId: number) => request<void>(`/friends/${userId}/accept`, { method: "POST" }),
  removeFriend: (userId: number) => request<void>(`/friends/${userId}`, { method: "DELETE" }),
};
