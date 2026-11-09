import { Check, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Player } from "../../lib/api";
import { invoke } from "../../lib/platform";
import { saveLocal } from "../../lib/storage";
import { NAME_UNDO_KEY, type NameMatch } from "./LiveBar";

/** 오버레이의 이름 질문 한 건. 답하면 이름 이미지를 기억하고, 잠깐 되돌릴 수 있다 */
export function PartyAsk({
  captureId,
  row,
  heroName,
  crop,
  suggestion,
  players,
  onDone,
}: {
  captureId: number;
  row: number;
  heroName: string | null;
  crop: string | null;
  /** null이면 제안 없이 목록에서 고르게 묻는다 */
  suggestion: NameMatch | null;
  players: Player[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"ask" | "pick" | "undo" | "error">(suggestion ? "ask" : "pick");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const base: NameMatch = suggestion ?? { player: 0, name: "", score: 0, known: false, candidates: [] };
  const [confirmed, setConfirmed] = useState<NameMatch>(base);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const startUndo = (id: number, match: NameMatch) => {
    setTemplateId(id);
    setConfirmed(match);
    setMode("undo");
    // Keep the overlay clickable only for this short recovery window, then go back to click-through.
    timer.current = window.setTimeout(() => onDone(), 6000);
  };
  const confirm = async (player: { id: number; name: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await invoke<number>("live_confirm_name", { captureId, row, playerId: player.id });
      startUndo(id, { ...base, player: player.id, name: player.name, known: true });
    } catch (e) {
      setError(String(e));
      setMode("error");
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("live_reject_name", { captureId, row });
      onDone();
    } catch (e) {
      setError(String(e));
      setMode("error");
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (busy || templateId === null) return;
    setBusy(true);
    try {
      await invoke("live_forget_name_template", { templateId });
      // 메인 창은 정해진 사람을 그 판 동안 유지하므로, 이 지정이 틀렸다고 알린다
      saveLocal(NAME_UNDO_KEY, { player: confirmed.player, at: Date.now() });
      onDone();
    } catch (e) {
      setError(String(e));
      setMode("error");
    } finally {
      setBusy(false);
    }
  };

  const primary = "rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50";
  const secondary = "rounded-md border border-white/25 px-2.5 py-1.5 text-xs text-white/90 disabled:opacity-50";
  const quiet = "px-2 py-1 text-[11px] text-white/60 hover:text-white";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/15 bg-black/35 p-2">
      <div className="flex items-start gap-2">
        {crop ? (
          <img src={crop} alt="" className="h-9 max-w-32 shrink-0 rounded-sm bg-black/40 object-contain" />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-white/10 text-xs text-white/60">
            ?
          </span>
        )}
        <div className="min-w-0 flex-1">
          {mode === "ask" && (
            <p className="text-sm font-medium leading-snug">
              {t("live.partyAskOverlay", { name: base.name })}
            </p>
          )}
          {mode === "pick" && <p className="text-sm font-medium">{t("live.partyAskWho")}</p>}
          {mode === "undo" && (
            <p className="flex items-center gap-1 text-sm font-medium text-good">
              <Check className="size-4" />
              {t("live.partyConfirmed", { name: confirmed.name })}
            </p>
          )}
          {mode === "error" && <p className="text-xs text-bad">{t("live.partyAskFailed")}</p>}
          {heroName && <p className="text-[11px] text-white/55">{heroName}</p>}
        </div>
      </div>

      {mode === "ask" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => confirm({ id: base.player, name: base.name })}
          >
            {t("live.partyYes")}
          </button>
          {base.candidates
            .filter((c) => c.player !== base.player)
            .slice(0, 2)
            .map((c) => (
              <button
                key={c.player}
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => {
                  const p = players.find((x) => x.id === c.player);
                  if (p) confirm(p);
                  else setMode("pick");
                }}
              >
                {c.name}
              </button>
            ))}
          <button type="button" className={secondary} disabled={busy} onClick={() => setMode("pick")}>
            {t("live.partyNo")}
          </button>
          <button type="button" className={quiet} onClick={onDone}>
            {t("live.partyLater")}
          </button>
        </div>
      )}

      {mode === "pick" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {base.candidates.map((c) => (
              <button
                key={c.player}
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => {
                  const p = players.find((x) => x.id === c.player);
                  if (p) confirm(p);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
          <select
            aria-label={t("live.partyMatchPick")}
            defaultValue=""
            disabled={busy}
            onChange={(e) => {
              const p = players.find((x) => x.id === Number(e.target.value));
              if (p) confirm(p);
            }}
            className="h-8 w-full rounded-md border border-white/20 bg-black/40 px-2 text-xs text-white"
          >
            <option value="">{t("live.partyMatchPick")}</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={secondary} disabled={busy} onClick={reject}>
              {t("live.partyNotRegistered")}
            </button>
            <button type="button" className={quiet} onClick={onDone}>
              {t("live.partyLater")}
            </button>
          </div>
        </div>
      )}

      {mode === "undo" && (
        <div className="flex items-center gap-2">
          <button type="button" className={secondary} disabled={busy} onClick={undo}>
            <Undo2 className="mr-1 inline size-3.5" />
            {t("live.partyUndo")}
          </button>
          <span className="text-[11px] text-white/50">{t("live.partyUndoHint")}</span>
          <button type="button" className="ml-auto text-white/50 hover:text-white" aria-label={t("common.close")} onClick={onDone}>
            <X className="size-4" />
          </button>
        </div>
      )}

      {mode === "error" && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-white/50">{error}</span>
          <button type="button" className={quiet} onClick={onDone}>
            {t("common.close")}
          </button>
        </div>
      )}
    </div>
  );
}
