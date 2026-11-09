import { BOARD_KEY, newMatch, type Board } from "../features/pick/board";
import { loadLocal, removeLocal, saveLocal } from "./storage";

/**
 * 픽각을 새로 켜면 지난 판의 영웅·금지·전장을 비우고 시작한다. 파티 구성과 대기열은 남긴다.
 * 같은 창에서 새로고침할 때는 그대로 둔다 (sessionStorage는 창을 닫거나 앱을 끄면 사라진다).
 * 오버레이 창은 메인 창이 비운 판을 따라가기만 하므로 여기서 건드리지 않는다.
 */
const SESSION_KEY = "pickgak.session";

export function startFresh() {
  try {
    if (sessionStorage.getItem(SESSION_KEY) !== null) return;
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    return; // 세션을 구분할 수 없으면 예전처럼 이어서 보여준다
  }
  try {
    const saved = loadLocal<Board | null>(BOARD_KEY, null);
    if (saved) saveLocal(BOARD_KEY, newMatch(saved));
  } catch {
    removeLocal(BOARD_KEY); // 예전 형식이라 비울 수 없는 판은 버린다
  }
  saveLocal("pickgak.map", "all");
}
