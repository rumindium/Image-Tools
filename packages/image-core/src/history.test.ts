import { describe, expect, it } from 'bun:test';
import { HISTORY_LIMIT, canRedo, canUndo, createHistory, current, record, redo, undo } from './history.ts';

const same = (a: number, b: number): boolean => a === b;

describe('edit history', () => {
  it('starts on the base entry with both directions closed', () => {
    const history = createHistory(0);
    expect(history.entries).toEqual([0]);
    expect(history.index).toBe(0);
    expect(current(history)).toBe(0);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('moves the pointer without touching the entries', () => {
    let history = createHistory(0);
    history = record(history, 1, same);
    history = record(history, 2, same);
    const entries = history.entries;

    expect(history.index).toBe(2);
    expect(current(history)).toBe(2);
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.entries).toBe(entries);
    expect(history.index).toBe(1);
    expect(current(history)).toBe(1);

    history = redo(history);
    expect(history.index).toBe(2);
    expect(current(history)).toBe(2);
    expect(canRedo(history)).toBe(false);
  });

  it('ignores an entry equal to the current one', () => {
    const first = record(createHistory(0), 1, same);
    const again = record(first, 1, same);
    expect(again).toBe(first);
    expect(again.entries).toHaveLength(2);
  });

  it('drops the redo branch when a new entry is recorded after undo', () => {
    let history = createHistory(0);
    history = record(history, 1, same);
    history = record(history, 2, same);
    history = record(history, 3, same);
    history = undo(history);

    history = record(history, 9, same);
    expect(history.entries).toEqual([0, 1, 2, 9]);
    expect(history.index).toBe(3);
    expect(canRedo(history)).toBe(false);
  });

  it('caps committed entries at 50 while keeping the base', () => {
    let history = createHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 5; step += 1) {
      history = record(history, step, same);
    }

    expect(history.entries).toHaveLength(HISTORY_LIMIT + 1);
    expect(history.entries[0]).toBe(0);
    expect(history.entries[1]).toBe(6);
    expect(current(history)).toBe(HISTORY_LIMIT + 5);

    for (let step = 0; step < HISTORY_LIMIT; step += 1) history = undo(history);
    expect(current(history)).toBe(0);
    expect(canUndo(history)).toBe(false);

    for (let step = 0; step < HISTORY_LIMIT; step += 1) history = redo(history);
    expect(current(history)).toBe(HISTORY_LIMIT + 5);
    expect(canRedo(history)).toBe(false);
  });

  it('clamps undo and redo at both ends', () => {
    const base = createHistory(0);
    expect(undo(base)).toBe(base);
    expect(redo(base)).toBe(base);

    const one = record(base, 1, same);
    expect(redo(one)).toBe(one);

    const atBase = undo(undo(one));
    expect(atBase.index).toBe(0);
    expect(current(atBase)).toBe(0);
    expect(canUndo(atBase)).toBe(false);
    expect(canRedo(atBase)).toBe(true);
  });
});
