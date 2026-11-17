/**
 * The edit history of docs/03-EDIT.md §6: a bounded stack of committed operations with a pointer.
 * Entries are small value snapshots, never bitmaps — undo/redo moves the pointer and the caller
 * replays the stored state, so the base bitmap is decoded once.
 */

export const HISTORY_LIMIT = 50;

export type History<T> = {
  readonly entries: readonly T[];
  readonly index: number;
};

export function createHistory<T>(base: T): History<T> {
  return { entries: [base], index: 0 };
}

function first<T>(entries: readonly T[]): T {
  const entry = entries[0];
  if (entry === undefined) throw new Error('Edit history needs a base entry.');
  return entry;
}

function entryAt<T>(entries: readonly T[], index: number): T {
  return entries[index] ?? first(entries);
}

/**
 * Appends a committed entry and moves the pointer to it. An entry equal to the current one is a
 * no-op, and a new branch drops everything that had been ahead of the pointer. The base always
 * stays at index 0: past 50 committed entries the oldest one after the base is dropped.
 */
export function record<T>(history: History<T>, entry: T, equals: (a: T, b: T) => boolean): History<T> {
  if (equals(entryAt(history.entries, history.index), entry)) return history;

  let entries = [...history.entries.slice(0, history.index + 1), entry];
  if (entries.length > HISTORY_LIMIT + 1) {
    entries = [first(entries), ...entries.slice(entries.length - HISTORY_LIMIT)];
  }
  return { entries, index: entries.length - 1 };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.index > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.index < history.entries.length - 1;
}

export function undo<T>(history: History<T>): History<T> {
  return canUndo(history) ? { entries: history.entries, index: history.index - 1 } : history;
}

export function redo<T>(history: History<T>): History<T> {
  return canRedo(history) ? { entries: history.entries, index: history.index + 1 } : history;
}

export function current<T>(history: History<T>): T {
  return entryAt(history.entries, history.index);
}
