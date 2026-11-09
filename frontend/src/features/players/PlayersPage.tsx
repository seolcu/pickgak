import { Check, HardDrive, Pencil, Plus, Star, Trash2, UserMinus, UserRound, UsersRound, X } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HeroAvatar } from "../../components/HeroAvatar";
import { HeroPicker } from "../../components/HeroPicker";
import { RoleIcon } from "../../components/RoleIcon";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, EmptyState, ROLE_TEXT, Skeleton, Switch } from "../../components/ui/misc";
import { Page, PageHeader } from "../../components/ui/Page";
import {
  useDeletePlayer,
  useFriendActions,
  useFriends,
  useHeroes,
  usePlayers,
  useSavePlayer,
} from "../../hooks/data";
import { ApiError } from "../../lib/api";
import { ROLES, type Hero, type Player, type PlayerInput, type Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import { cleanAliases } from "../../lib/localPlayers";

const EMPTY: PlayerInput = { name: "", aliases: [], is_me: false, preferred_roles: [], heroes: [], only_preferred: false };

/** 부계정 닉네임 입력란: 쉼표로 나눈다 (게임 닉네임에는 쉼표를 쓸 수 없다) */
const splitAliases = (text: string) => text.split(/[,，]/).map((s) => s.trim());

export function PlayersPage() {
  const { t } = useTranslation();
  const { players: all, isLoading, guest } = usePlayers();
  // 친구 계정은 아래 친구 칸에서 따로 보여 준다 (읽기 전용)
  const players = all.filter((p) => !p.friend);
  const { heroes, byId } = useHeroes();
  // null: 편집 안 함, "new": 새로 만들기, 숫자: 그 플레이어 편집
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const editingPlayer = typeof editing === "number" ? players.find((p) => p.id === editing) : undefined;

  return (
    <Page>
      <PageHeader
        title={t("players.title")}
        lead={t("players.subtitle")}
        actions={
          editing === null && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("players.add")}
            </Button>
          )
        }
      />

      {guest && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          <HardDrive className="size-4 shrink-0" />
          {t("players.guestNote")}
          <Link to="/account" className="font-medium text-accent underline-offset-2 hover:underline">
            {t("account.login")} / {t("account.signup")}
          </Link>
        </p>
      )}

      {editing !== null && (
        <PlayerEditor
          key={editing}
          initial={editingPlayer ?? { ...EMPTY, is_me: players.length === 0 }}
          id={editingPlayer?.id}
          heroes={heroes}
          onDone={() => setEditing(null)}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : players.length === 0 && editing === null ? (
        <EmptyState
          icon={<UserRound />}
          title={t("players.empty")}
          description={t("players.emptyHint")}
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              {t("players.addMe")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {players.map((p) => (
            <PlayerCard key={p.id} player={p} byId={byId} onEdit={() => setEditing(p.id)} />
          ))}
        </div>
      )}

      {guest ? (
        <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          <UsersRound className="size-4 shrink-0" />
          {t("friends.guest")}
        </p>
      ) : (
        <FriendsPanel byId={byId} />
      )}
    </Page>
  );
}

function PlayerCard({ player, byId, onEdit }: { player: Player; byId: Map<string, Hero>; onEdit: () => void }) {
  const { t } = useTranslation();
  const del = useDeletePlayer();
  const remove = () => {
    if (!window.confirm(t("players.confirmDelete", { name: player.name }))) return;
    del.mutate(player.id, { onSuccess: () => toast(t("players.deleted", { name: player.name })) });
  };
  return (
    <Card className={cn("flex flex-col gap-3 p-4", player.is_me && "border-accent/50")}>
      <div className="flex items-center gap-2">
        <span className="truncate font-semibold">{player.name}</span>
        {player.is_me && <Badge tone="solid">{t("pick.me")}</Badge>}
        {player.only_preferred && player.heroes.length > 0 && (
          <Badge tone="accent">{t("players.onlyPreferredBadge")}</Badge>
        )}
        <span className="flex items-center gap-1 text-xs text-muted">
          {player.preferred_roles.length
            ? player.preferred_roles.map((r) => <RoleIcon key={r} role={r} className={ROLE_TEXT[r]} />)
            : t("players.anyRole")}
        </span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("common.edit")}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} aria-label={t("common.delete")}>
            <Trash2 className="size-4" />
          </Button>
        </span>
      </div>
      <AliasLine aliases={player.aliases} />
      {player.heroes.length ? (
        <HeroesByRole ids={player.heroes} byId={byId} />
      ) : (
        <p className="text-sm text-muted">{t("players.noPreferred")}</p>
      )}
    </Card>
  );
}

function PlayerEditor({
  initial,
  id,
  heroes,
  onDone,
}: {
  initial: PlayerInput;
  id?: number;
  heroes: Hero[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const save = useSavePlayer();
  const [form, setForm] = useState<PlayerInput>({
    name: initial.name,
    aliases: initial.aliases ?? [],
    is_me: initial.is_me,
    preferred_roles: initial.preferred_roles,
    heroes: initial.heroes,
    only_preferred: initial.only_preferred,
  });
  const [aliasText, setAliasText] = useState((initial.aliases ?? []).join(", "));

  // 세 역할을 다 고르면 '상관없음'(빈 목록)과 같으므로 자동으로 정리한다
  const toggleRole = (r: Role) =>
    setForm((f) => {
      const next = f.preferred_roles.includes(r) ? f.preferred_roles.filter((x) => x !== r) : [...f.preferred_roles, r];
      return { ...f, preferred_roles: next.length === ROLES.length ? [] : ROLES.filter((x) => next.includes(x)) };
    });
  const toggleHero = (h: string) =>
    setForm((f) => ({ ...f, heroes: f.heroes.includes(h) ? f.heroes.filter((x) => x !== h) : [...f.heroes, h] }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    save.mutate(
      { id, data: { ...form, name: form.name.trim(), aliases: cleanAliases(form.name, splitAliases(aliasText)) } },
      {
        onSuccess: () => {
          toast.success(t("players.saved"));
          onDone();
        },
        onError: () => toast.error(t("errors.unknown")),
      },
    );
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-48 max-w-md flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">{t("players.name")}</span>
            <input
              required
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("players.namePlaceholder")}
              className="h-10 rounded-lg border border-border bg-surface px-3"
            />
          </label>
          <Switch checked={form.is_me} onChange={(v) => setForm({ ...form, is_me: v })} label={t("players.isMe")} />
        </div>

        <label className="flex max-w-md flex-col gap-1 text-sm">
          <span className="font-medium">{t("players.aliases")}</span>
          <span className="text-xs text-muted">{t("players.aliasesHint")}</span>
          <input
            maxLength={450}
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder={t("players.aliasesPlaceholder")}
            className="h-10 rounded-lg border border-border bg-surface px-3"
          />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">{t("players.preferredRoles")}</legend>
          <p className="text-xs text-muted">{t("players.preferredRolesHint")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={form.preferred_roles.length === 0}
              onClick={() => setForm((f) => ({ ...f, preferred_roles: [] }))}
              className={cn(
                "inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium",
                form.preferred_roles.length === 0 ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
              )}
            >
              {t("players.anyRole")}
            </button>
            {ROLES.map((r) => {
              const on = form.preferred_roles.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRole(r)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
                    on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                  )}
                >
                  <RoleIcon role={r} className={ROLE_TEXT[r]} />
                  {t(`roles.${r}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Star className="size-4 fill-accent text-accent" />
            {t("players.preferredHeroes", { n: form.heroes.length })}
          </p>
          <p className="text-xs text-muted">{t("players.preferredHint")}</p>
          <div className="py-1">
            <Switch
              checked={form.only_preferred && form.heroes.length > 0}
              disabled={!form.heroes.length}
              onChange={(v) => setForm({ ...form, only_preferred: v })}
              label={t("players.onlyPreferred")}
              title={form.heroes.length ? t("players.onlyPreferredHint") : t("players.onlyPreferredNeedsHeroes")}
            />
          </div>
          {form.heroes.length > 0 && (
            <div className="rounded-lg bg-surface-2 p-2">
              <HeroesByRole ids={form.heroes} byId={new Map(heroes.map((h) => [h.hero_id, h]))} onRemove={toggleHero} />
            </div>
          )}
          <HeroPicker heroes={heroes} selected={form.heroes} onToggle={toggleHero} />
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || !form.name.trim()}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** 부계정 닉네임 한 줄 (없으면 아무것도 그리지 않는다) */
function AliasLine({ aliases }: { aliases?: string[] }) {
  const { t } = useTranslation();
  if (!aliases?.length) return null;
  return <p className="-mt-2 truncate text-xs text-muted">{t("players.aliasesLine", { names: aliases.join(", ") })}</p>;
}

/** 영웅 목록을 역할별 줄로 (줄 앞에 역할 아이콘) */
function HeroesByRole({
  ids,
  byId,
  onRemove,
}: {
  ids: string[];
  byId: Map<string, Hero>;
  onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      {ROLES.map((r) => {
        const list = ids
          .map((id) => byId.get(id))
          .filter((h): h is Hero => !!h && h.role === r)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <div key={r} className="flex items-start gap-2">
            <span className={cn("mt-1.5 flex w-14 shrink-0 items-center gap-1 text-xs font-medium", ROLE_TEXT[r])}>
              <RoleIcon role={r} className="size-3.5" />
              {t(`roles.${r}`)}
            </span>
            <div className="flex flex-wrap gap-1">
              {list.map((h) =>
                onRemove ? (
                  <button
                    key={h.hero_id}
                    type="button"
                    onClick={() => onRemove(h.hero_id)}
                    title={t("players.removeHero", { name: h.name })}
                    className="flex items-center gap-1 rounded-md bg-surface py-0.5 pr-2 pl-0.5 text-xs hover:bg-enemy-soft"
                  >
                    <HeroAvatar hero={h} size="xs" />
                    {h.name}
                  </button>
                ) : (
                  <span key={h.hero_id} title={h.name} className="flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-2 pl-0.5 text-xs">
                    <HeroAvatar hero={h} size="xs" />
                    {h.name}
                  </span>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const friendError = (t: (k: string) => string, e: unknown) =>
  t(`errors.${e instanceof ApiError ? e.code : "unknown"}`);

/** 친구: 아이디로 요청, 받은 요청 수락·거절, 보낸 요청 취소, 친구 프로필(읽기 전용) */
function FriendsPanel({ byId }: { byId: Map<string, Hero> }) {
  const { t } = useTranslation();
  const { friends, incoming, outgoing, isLoading } = useFriends();
  const { request, accept, remove } = useFriendActions();
  const [name, setName] = useState("");

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const username = name.trim();
    if (!username) return;
    request.mutate(username, {
      onSuccess: (r) => {
        toast.success(t(r.status === "accepted" ? "friends.accepted" : "friends.requested", { name: r.username }));
        setName("");
      },
    });
  };
  const unfriend = (userId: number, username: string) => {
    if (!window.confirm(t("friends.confirmRemove", { name: username }))) return;
    remove.mutate(userId, { onSuccess: () => toast(t("friends.removed", { name: username })) });
  };

  return (
    <section aria-labelledby="friends-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="friends-title" className="flex items-center gap-2 text-lg font-semibold">
          <UsersRound className="size-5 text-accent" />
          {t("friends.title")}
        </h2>
        <p className="text-sm text-muted">{t("friends.lead")}</p>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <form onSubmit={send} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              request.reset();
            }}
            placeholder={t("friends.usernamePlaceholder")}
            aria-label={t("friends.usernamePlaceholder")}
            maxLength={20}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
          />
          <Button type="submit" variant="primary" disabled={request.isPending || !name.trim()}>
            <Plus className="size-4" />
            {t("friends.add")}
          </Button>
        </form>
        {request.error && (
          <p role="alert" className="text-sm text-bad">
            {friendError(t, request.error)}
          </p>
        )}
        <p className="text-xs text-muted">{t("friends.shareNote")}</p>

        {incoming.length > 0 && (
          <RequestList title={t("friends.incoming")}>
            {incoming.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-medium">{p.username}</span>
                <Button size="sm" variant="primary" disabled={accept.isPending} onClick={() => accept.mutate(p.user_id)}>
                  <Check className="size-4" />
                  {t("friends.accept")}
                </Button>
                <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(p.user_id)}>
                  {t("friends.decline")}
                </Button>
              </li>
            ))}
          </RequestList>
        )}
        {outgoing.length > 0 && (
          <RequestList title={t("friends.outgoing")}>
            {outgoing.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-muted">{p.username}</span>
                <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(p.user_id)}>
                  <X className="size-4" />
                  {t("friends.cancel")}
                </Button>
              </li>
            ))}
          </RequestList>
        )}
      </Card>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : friends.length === 0 ? (
        <p className="px-1 text-sm text-muted">{t("friends.none")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {friends.map((f) => (
            <Card key={f.user_id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{f.profile?.name || f.username}</span>
                {f.profile?.name && f.profile.name !== f.username && (
                  <span className="truncate text-xs text-muted">@{f.username}</span>
                )}
                <Badge tone="ally">{t("friends.badge")}</Badge>
                {f.profile?.only_preferred && f.profile.heroes.length > 0 && (
                  <Badge tone="accent">{t("players.onlyPreferredBadge")}</Badge>
                )}
                {f.profile && (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    {f.profile.preferred_roles.length
                      ? f.profile.preferred_roles.map((r) => <RoleIcon key={r} role={r} className={ROLE_TEXT[r]} />)
                      : t("players.anyRole")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => unfriend(f.user_id, f.username)}
                  aria-label={t("friends.remove")}
                  title={t("friends.remove")}
                >
                  <UserMinus className="size-4" />
                </Button>
              </div>
              <AliasLine aliases={f.profile?.aliases} />
              {!f.profile ? (
                <p className="text-sm text-muted">{t("friends.noProfile")}</p>
              ) : f.profile.heroes.length ? (
                <HeroesByRole ids={f.profile.heroes} byId={byId} />
              ) : (
                <p className="text-sm text-muted">{t("players.noPreferred")}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function RequestList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted">{title}</p>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}
