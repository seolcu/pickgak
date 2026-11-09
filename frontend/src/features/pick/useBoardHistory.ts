import { useCallback, useState } from "react";
import type { Board } from "./board";

const LIMIT = 20;

/** 판 상태 + 되돌리기 (최근 LIMIT단계). 같은 상태로 바꾸면 기록하지 않는다 */
export function useBoardHistory(initial: () => Board) {
  const [state, setState] = useState(() => ({ past: [] as Board[], board: initial() }));
  const setBoard = useCallback(
    (next: Board) =>
      setState((s) => (next === s.board ? s : { past: [...s.past, s.board].slice(-LIMIT), board: next })),
    [],
  );
  const undo = useCallback(
    () => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), board: s.past[s.past.length - 1] } : s)),
    [],
  );
  return { board: state.board, setBoard, undo, canUndo: state.past.length > 0 };
}
