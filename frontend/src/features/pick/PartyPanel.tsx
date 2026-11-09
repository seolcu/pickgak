import * as Popover from "@radix-ui/react-popover";
import { Plus, Star, UserCheck, UserPlus, X } from "lucide-react";
import { HeroAvatar } from "../../components/HeroAvatar";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { RoleIcon } from "../../components/RoleIcon";
import { ROLE_BG, ROLE_TEXT } from "../../components/ui/misc";
import { ROLES, type Hero, type Player, type Role } from "../../lib/api";
import { cn } from "../../lib/cn";
import { canAddMember, chosenRole, onlyPreferredFor, slotOf, slotOfPerson, type Board, type Person } from "./board";

interface Props {
  board: Board;
  byId: Map<string, Hero>;
  players: Player[];
  me: Player | null;
  onRole: (p: Person, role: Role | null) => void;
  onAdd: (p: Person, role: Role | null, preferred: Role[]) => void;
  onRemove: (playerId: number) => void;
  /** 이번 판 '선호 영웅만' 켜기/끄기 */
  onOnlyPreferred: (p: Person, value: boolean) => void;
  /** 등록 안 된 친구를 이름만으로 바로 만들어 파티에 넣기 */
  onCreate: (name: string, role: Role | null) => void;
}

/**
 * 파티 구성. 사람마다 [자동·돌격·공격·지원] 버튼으로 이번 판 역할을 고른다.
 * 역할 고정 큐에서는 그 역할 자리로 옮기고(다른 파티원이 있으면 맞바꿈), 자유 큐에서는 역할만 기록한다.
 * '자동'이면 추천이 역할까지 정하고, 적용하면 그 역할 자리로 옮겨 간다.
 */
export function PartyPanel({ board, byId, players, me, onRole, onAdd, onRemove, onOnlyPreferred, onCreate }: Props) {
  const { t } = useTranslation();
  const heroOf = (p: Person) => {
    const h = slotOfPerson(board, p)?.hero;
    return h ? byId.get(h) : undefined;
  };
  const friends = players.filter((p) => !p.is_me);
  const inParty = friends.filter((p) => slotOf(board, p.id));
  const outside = friends.filter((p) => !slotOf(board, p.id));
  const meP: Person = { kind: "me" };

  return (
    <section aria-label={t("pick.party")} className="flex flex-wrap items-center gap-2">

      <MemberPill
        label={me?.name ?? t("pick.me")}
        isMe
        hero={heroOf(meP)}
        role={chosenRole(board, meP)}
        preferred={me?.preferred_roles ?? []}
        onRole={(r) => onRole(meP, r)}
        only={onlyPreferredFor(board, meP, me)}
        canOnly={!!me?.heroes.length}
        onOnly={(v) => onOnlyPreferred(meP, v)}
      />

      {inParty.map((p) => {
        const person: Person = { kind: "player", id: p.id };
        return (
          <MemberPill
            key={p.id}
            label={p.name}
            hero={heroOf(person)}
            role={chosenRole(board, person)}
            preferred={p.preferred_roles}
            onRole={(r) => onRole(person, r)}
            onRemove={() => onRemove(p.id)}
            only={onlyPreferredFor(board, person, p)}
            canOnly={p.heroes.length > 0}
            onOnly={(v) => onOnlyPreferred(person, v)}
          />
        );
      })}

      <AddMember
        candidates={outside}
        disabled={!canAddMember(board)}
        compact={inParty.length > 0}
        onAdd={(p, role) => onAdd({ kind: "player", id: p.id }, role, p.preferred_roles)}
        onCreate={onCreate}
      />

      {!me && (
        <Link to="/players" className="text-xs text-accent underline-offset-2 hover:underline">
          {t("pick.createMe")}
        </Link>
      )}
    </section>
  );
}

function RoleButtons({
  role,
  preferred,
  onPick,
  size = "md",
}: {
  /** undefined면 아무것도 선택되지 않은 상태 (추가 목록) */
  role: Role | null | undefined;
  preferred: Role[];
  onPick: (r: Role | null) => void;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const options: (Role | null)[] = [null, ...ROLES];
  return (
    <span role="radiogroup" aria-label={t("pick.roleThisMatch")} className="inline-flex gap-0.5">
      {options.map((r) => {
        const on = role === r;
        return (
          <button
            key={r ?? "auto"}
            type="button"
            role="radio"
            aria-checked={on}
            title={
              (r ? t(`roles.${r}`) : t("pick.roleAuto")) + (r && preferred.includes(r) ? ` · ${t("common.preferred")}` : "")
            }
            onClick={() => onPick(r)}
            className={cn(
              "relative inline-flex items-center justify-center rounded-md transition",
              size === "sm" ? "h-7 min-w-7 px-1.5" : "h-8 min-w-8 px-1.5",
              on
                ? cn("text-white", r ? ROLE_BG[r] : "bg-muted")
                : cn("hover:bg-surface-2", r ? ROLE_TEXT[r] : "text-muted"),
            )}
          >
            {r ? <RoleIcon role={r} className="size-4" /> : <span className="text-[11px] font-semibold">{t("pick.roleAutoShort")}</span>}
            {r && preferred.includes(r) && !on && (
              <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent" aria-hidden />
            )}
          </button>
        );
      })}
    </span>
  );
}

function MemberPill({
  label,
  isMe,
  hero,
  role,
  preferred,
  onRole,
  onRemove,
  only,
  canOnly,
  onOnly,
}: {
  label: string;
  isMe?: boolean;
  hero?: Hero;
  role: Role | null;
  preferred: Role[];
  onRole: (r: Role | null) => void;
  onRemove?: () => void;
  only: boolean;
  canOnly: boolean;
  onOnly: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-xl border bg-surface pr-1 pl-3",
        isMe ? "border-accent" : "border-ally/60",
      )}
    >
      {isMe ? <Star className="size-3.5 fill-accent text-accent" /> : null}
      <span className={cn("max-w-32 truncate text-sm font-semibold", isMe ? "text-accent" : "text-ally")}>{label}</span>
      {/* 지금 고른 영웅. 추천은 계속 받는다 (파티원이 픽을 바꿀 수 있다). 자리는 늘 잡아 둔다 */}
      <span className="inline-flex size-6 items-center justify-center" title={hero ? t("pick.currentHero", { hero: hero.name }) : undefined}>
        {hero && <HeroAvatar hero={hero} size="xs" />}
      </span>
      <RoleButtons role={role} preferred={preferred} onPick={onRole} />
      {/* 이번 판 선호 영웅만 */}
      <button
        type="button"
        aria-pressed={only}
        disabled={!canOnly}
        onClick={() => onOnly(!only)}
        title={!canOnly ? t("pick.onlyPreferredNone") : only ? t("pick.onlyPreferredToggle") : t("pick.onlyPreferredOff")}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md transition disabled:opacity-30",
          only ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2",
        )}
      >
        <Star className={cn("size-4", only && "fill-current")} />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("pick.removeFromParty")}
          aria-label={t("pick.removeFromParty")}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-bad"
        >
          <X className="size-4" />
        </button>
      )}
    </span>
  );
}

/**
 * 파티원 추가: 목록에서 역할 버튼을 바로 누르면 '추가 + 역할 지정'이 한 번에 된다.
 * 등록 안 된 친구는 이름을 쓰고 역할(또는 Enter)을 누르면 바로 만들어서 넣는다.
 */
function AddMember({
  candidates,
  disabled,
  compact,
  onAdd,
  onCreate,
}: {
  candidates: Player[];
  disabled: boolean;
  /** 이미 파티원이 있으면 아이콘만 (한 줄에 들어가게) */
  compact: boolean;
  onAdd: (p: Player, role: Role | null) => void;
  onCreate: (name: string, role: Role | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const typed = name.trim();
  const existing = candidates.find((p) => p.name.toLowerCase() === typed.toLowerCase());
  const add = (role: Role | null) => {
    if (!typed) return;
    if (existing) onAdd(existing, role);
    else onCreate(typed, role);
    setName("");
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? t("pick.noFreeSlot") : t("pick.addMember")}
          aria-label={t("pick.addMember")}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-border text-sm font-medium text-muted hover:border-ally hover:text-ally disabled:opacity-40",
            compact ? "w-10 justify-center" : "px-3",
          )}
        >
          <UserPlus className="size-4" />
          {!compact && t("pick.addMember")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex w-[min(92vw,380px)] flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-card"
        >
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 p-1.5">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add(null)}
              placeholder={t("pick.newFriendName")}
              aria-label={t("pick.newFriendName")}
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
            />
            <RoleButtons role={undefined} preferred={[]} size="sm" onPick={add} />
          </div>
          <p className="px-1 pt-1 pb-0.5 text-xs text-muted">{t("pick.addMemberHint")}</p>
          {candidates.length === 0 && (
            <p className="px-1 py-3 text-center text-sm text-muted">{t("pick.noMoreFriends")}</p>
          )}
          {candidates.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
              <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
                <span className="truncate">{p.name}</span>
                {p.friend && (
                  <UserCheck className="size-3.5 shrink-0 text-ally" aria-label={t("friends.linked")}>
                    <title>{t("friends.linked")}</title>
                  </UserCheck>
                )}
              </span>
              <RoleButtons
                role={undefined}
                preferred={p.preferred_roles}
                size="sm"
                onPick={(r) => {
                  onAdd(p, r);
                  setOpen(false);
                }}
              />
            </div>
          ))}
          <Link
            to="/players"
            onClick={() => setOpen(false)}
            className="mt-1 inline-flex items-center gap-1 rounded-lg px-1 py-1.5 text-xs text-muted hover:text-text"
          >
            <Plus className="size-3.5" />
            {t("pick.manageFriends")}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
