/**
 * Undo/redo for scene edits, as a pure reducer.
 *
 * Rapid edits that share a `key` (typing in a number field, dragging a handle, moving a slider)
 * within COALESCE_MS merge into one undo step. `now` comes in with the action so the reducer stays
 * pure.
 */
export const COALESCE_MS = 800;
export const MAX_HISTORY = 100;

export interface History<S> {
  past: S[];
  present: S;
  future: S[];
  /** Key and time of the last edit, for coalescing. */
  key: string | null;
  at: number;
}

export type HistoryAction<S> =
  | { type: "reset"; present: S }
  | { type: "edit"; next: (s: S) => S; key?: string; now: number }
  | { type: "undo" }
  | { type: "redo" };

export const createHistory = <S>(present: S): History<S> => ({ past: [], present, future: [], key: null, at: 0 });

export function historyReducer<S>(h: History<S>, action: HistoryAction<S>): History<S> {
  switch (action.type) {
    case "reset":
      return createHistory(action.present);
    case "edit": {
      const next = action.next(h.present);
      if (next === h.present) return h;
      const coalesce = action.key !== undefined && action.key === h.key && action.now - h.at < COALESCE_MS && h.past.length > 0;
      return {
        past: coalesce ? h.past : [...h.past, h.present].slice(-MAX_HISTORY),
        present: next,
        future: [],
        key: action.key ?? null,
        at: action.now,
      };
    }
    case "undo": {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: null, at: 0 };
    }
    case "redo": {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: null, at: 0 };
    }
  }
}
