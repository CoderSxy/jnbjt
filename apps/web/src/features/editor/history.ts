export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return {
    past: [...state.past, state.present].slice(-50),
    present: next,
    future: [],
  };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1]!;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state;
  const next = state.future[0]!;
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}
