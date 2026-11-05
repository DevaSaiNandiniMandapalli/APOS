export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const ANNOTATION_HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

/** Record a completed change and invalidate any redo branch. */
export function commitHistory<T>(
  history: HistoryState<T>,
  present: T,
  limit = ANNOTATION_HISTORY_LIMIT,
): HistoryState<T> {
  if (Object.is(history.present, present)) return history;

  return {
    past: [...history.past, history.present].slice(-limit),
    present,
    future: [],
  };
}

/** Update the visible state without adding a history entry (for live edits). */
export function replaceHistoryPresent<T>(
  history: HistoryState<T>,
  present: T,
): HistoryState<T> {
  if (Object.is(history.present, present)) return history;

  return { ...history, present };
}

/**
 * Finish a series of live edits by recording the state that existed before
 * the edits began. This groups one property-editing session into one undo step.
 */
export function commitHistorySince<T>(
  history: HistoryState<T>,
  previousPresent: T,
  limit = ANNOTATION_HISTORY_LIMIT,
): HistoryState<T> {
  if (Object.is(history.present, previousPresent)) return history;

  return {
    past: [...history.past, previousPresent].slice(-limit),
    present: history.present,
    future: [],
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history;

  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, ANNOTATION_HISTORY_LIMIT),
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history;

  const next = history.future[0];
  if (next === undefined) return history;

  return {
    past: [...history.past, history.present].slice(-ANNOTATION_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}
