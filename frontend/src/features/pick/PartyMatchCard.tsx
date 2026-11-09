import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HeroAvatar } from "../../components/HeroAvatar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/misc";
import { Select } from "../../components/ui/Select";
import type { Hero, Player } from "../../lib/api";
import type { NameMatch } from "../live/LiveBar";

export interface PartyNeed {
  /** 이 읽기가 담긴 캡처 (이름을 기억할 때 쓴다) */
  captureId: number;
  /** 캡처 안의 줄 번호 */
  row: number;
  slotId: string;
  hero: string;
  /** 아직 모를 때 보여 줄 이름 글자 그림 */
  crop: string | null;
  /** OCR/이름 이미지가 제안하는 후보 (없으면 직접 고른다) */
  suggestion: NameMatch | null;
  /** 지금 이 자리에 들어 있는 플레이어 (직접 고른 경우) */
  currentPlayer: number | null;
}

/**
 * 초록 파티 표시로 찾은 줄의 이름을 사람과 연결하는 카드.
 *
 * 자동으로 정하지 않는다: 확인된 이름 이미지가 있을 때만 자동이고, 처음 보는 이름은 여기서 한 번
 * 확인한다. "아니요"를 고르면 후보를 다시 고르거나, 이번 판에서 묻지 않게 할 수 있다.
 */
export function PartyMatchCard({
  needs,
  players,
  byId,
  onPick,
  onReject,
  onSkip,
}: {
  needs: PartyNeed[];
  players: Player[];
  byId: Map<string, Hero>;
  onPick: (need: PartyNeed, playerId: number) => void;
  onReject: (need: PartyNeed) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!needs.length) return null;
  const playerName = (id: number) => players.find((p) => p.id === id)?.name ?? t("live.partySomeone");
  const pick = async (n: PartyNeed, playerId: number) => {
    if (busy) return;
    setBusy(n.slotId);
    try {
      await onPick(n, playerId);
      setPicking((p) => ({ ...p, [n.slotId]: false }));
    } catch {
      // keep the card open so the user can try another answer
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{t("live.partyMatchTitle")}</h2>
          <p className="text-xs text-muted">{t("live.partyMatchHint")}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          {t("live.partyMatchSkip")}
        </Button>
      </div>
      {needs.map((n) => {
        const hero = byId.get(n.hero);
        const suggested = n.suggestion;
        const showPick = !!picking[n.slotId] || !suggested;
        return (
          <div
            key={n.slotId}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/60 p-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <HeroAvatar hero={hero} size="sm" />
              <span className="shrink-0 text-sm font-medium">{hero?.name ?? n.hero}</span>
              {n.crop && (
                <img
                  src={n.crop}
                  alt=""
                  className="ml-auto h-7 max-w-[55%] rounded-sm bg-black/30 object-contain"
                />
              )}
            </div>
            {suggested && !showPick ? (
              <>
                <p className="text-sm">
                  {t("live.partyAsk", { name: suggested.name })}
                  {n.currentPlayer !== null && (
                    <span className="ml-1 text-xs text-muted">
                      ({playerName(n.currentPlayer)})
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {suggested.candidates
                    .filter((c) => c.player !== suggested.player)
                    .slice(0, 2)
                    .map((c) => (
                      <Button key={c.player} size="sm" variant="secondary" onClick={() => pick(n, c.player)}>
                        {c.name}
                      </Button>
                    ))}
                  <Button size="sm" onClick={() => pick(n, suggested.player)} disabled={!!busy}>
                    {t("live.partyYes")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicking((p) => ({ ...p, [n.slotId]: true }))}>
                    {t("live.partyNo")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onReject(n)} disabled={!!busy}>
                    {t("live.partyNotRegistered")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <Select
                  className="min-w-32 flex-1"
                  aria-label={t("live.partyMatchPick")}
                  value={n.currentPlayer ?? ""}
                  onChange={(e) => e.target.value && pick(n, Number(e.target.value))}
                >
                  <option value="">{t("live.partyMatchPick")}</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => onReject(n)} disabled={!!busy}>
                  {t("live.partyNotRegistered")}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
