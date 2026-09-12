import { observable } from '@legendapp/state';
import { syncObservable } from '@legendapp/state/sync';

import { MemoryRowStore, RowPersistPlugin } from './row-persist';

type Item = { id: string; name: string; is_checked: boolean };

function makeStore(rowStore: MemoryRowStore, plugin: RowPersistPlugin) {
  const store$ = observable({
    items: {} as Record<string, Item>,
    meta: { cursor: null as number | null, theme: 'system' as string },
  });
  const itemsState$ = syncObservable(store$.items, { persist: { name: 'test.items', plugin } });
  const metaState$ = syncObservable(store$.meta, { persist: { name: 'test.meta', plugin } });
  return { store$, itemsState$, metaState$ };
}

describe('RowPersistPlugin', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes one row per top-level key and coalesces a burst into one write', async () => {
    const rowStore = new MemoryRowStore();
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 100 });
    const { store$ } = makeStore(rowStore, plugin);

    store$.items['a'].set({ id: 'a', name: 'Milk', is_checked: false });
    store$.items['b'].set({ id: 'b', name: 'Eggs', is_checked: false });
    store$.items['a'].is_checked.set(true);
    store$.meta.cursor.set(7);

    // Legend batches into a microtask before calling the plugin.
    await jest.advanceTimersByTimeAsync(0);
    expect(rowStore.writes).toBe(0); // nothing on disk yet — off the tap frame
    await jest.advanceTimersByTimeAsync(100);
    await plugin.flush(); // wait for the in-flight write, nothing new is collected

    expect(rowStore.writes).toBe(1);
    expect(JSON.parse(rowStore.tables.get('test.items')!.get('a')!)).toEqual({
      id: 'a',
      name: 'Milk',
      is_checked: true,
    });
    expect(rowStore.tables.get('test.items')!.size).toBe(2);
    expect(rowStore.tables.get('test.meta')!.get('cursor')).toBe('7');
  });

  it('only touches the rows that changed', async () => {
    const rowStore = new MemoryRowStore();
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 10 });
    const { store$ } = makeStore(rowStore, plugin);
    store$.items['a'].set({ id: 'a', name: 'Milk', is_checked: false });
    store$.items['b'].set({ id: 'b', name: 'Eggs', is_checked: false });
    await jest.advanceTimersByTimeAsync(0); // let Legend hand the changes to the plugin
    await plugin.flush();

    const spy = jest.spyOn(rowStore, 'writeAsync');
    store$.items['a'].is_checked.set(true);
    await jest.advanceTimersByTimeAsync(0);
    await plugin.flush();

    expect(spy).toHaveBeenCalledTimes(1);
    const [clear, ops] = spy.mock.calls[0];
    expect(clear).toEqual([]);
    expect(ops).toEqual([{ tbl: 'test.items', key: 'a', json: expect.stringContaining('"is_checked":true') }]);
  });

  it('deletes a row when its key is removed, and rewrites the table on a whole-table set', async () => {
    const rowStore = new MemoryRowStore();
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 10 });
    const { store$ } = makeStore(rowStore, plugin);
    store$.items['a'].set({ id: 'a', name: 'Milk', is_checked: false });
    store$.items['b'].set({ id: 'b', name: 'Eggs', is_checked: false });
    await jest.advanceTimersByTimeAsync(0);
    await plugin.flush();

    store$.items['a'].delete();
    await jest.advanceTimersByTimeAsync(0);
    await plugin.flush();
    expect(Array.from(rowStore.tables.get('test.items')!.keys())).toEqual(['b']);

    store$.items.set({ c: { id: 'c', name: 'Bread', is_checked: false } });
    await jest.advanceTimersByTimeAsync(0);
    await plugin.flush();
    expect(Array.from(rowStore.tables.get('test.items')!.keys())).toEqual(['c']);
  });

  it('hydrates from rows on load', () => {
    const rowStore = new MemoryRowStore();
    rowStore.writeSync([], [
      { tbl: 'test.items', key: 'a', json: JSON.stringify({ id: 'a', name: 'Milk', is_checked: true }) },
      { tbl: 'test.meta', key: 'cursor', json: '42' },
    ]);
    const plugin = new RowPersistPlugin(rowStore);
    const { store$, itemsState$ } = makeStore(rowStore, plugin);

    expect(itemsState$.isPersistLoaded.get()).toBe(true);
    expect(store$.items['a'].name.get()).toBe('Milk');
    expect(store$.meta.cursor.get()).toBe(42);
    expect(store$.meta.theme.get()).toBe('system'); // default kept for unpersisted keys
  });

  it('imports a legacy whole-table blob into rows once, then drops it', () => {
    const rowStore = new MemoryRowStore();
    const kv = new Map<string, string>([
      ['test.items', JSON.stringify({ a: { id: 'a', name: 'Milk', is_checked: false } })],
      ['test.items__m', '{}'],
    ]);
    const legacy = {
      getItemSync: (key: string) => kv.get(key) ?? null,
      removeItemSync: (key: string) => kv.delete(key),
    };
    const plugin = new RowPersistPlugin(rowStore, { legacy });
    const { store$ } = makeStore(rowStore, plugin);

    expect(store$.items['a'].name.get()).toBe('Milk');
    expect(rowStore.tables.get('test.items')!.has('a')).toBe(true);
    expect(kv.has('test.items')).toBe(false);
    expect(kv.has('test.items__m')).toBe(false);
  });

  it('flushNow writes synchronously when nothing is in flight', async () => {
    const rowStore = new MemoryRowStore();
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 1000 });
    const { store$ } = makeStore(rowStore, plugin);
    store$.items['a'].set({ id: 'a', name: 'Milk', is_checked: false });
    await jest.advanceTimersByTimeAsync(0);

    plugin.flushNow();
    expect(rowStore.tables.get('test.items')!.has('a')).toBe(true);
    expect(plugin.hasPendingWrites).toBe(false);
  });

  it('caps how long continuous edits can postpone a write', async () => {
    const rowStore = new MemoryRowStore();
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 100, maxWaitMs: 300 });
    const { store$ } = makeStore(rowStore, plugin);

    for (let i = 0; i < 8; i += 1) {
      store$.items[`i${i}`].set({ id: `i${i}`, name: `n${i}`, is_checked: false });
      await jest.advanceTimersByTimeAsync(60); // always inside the trailing delay
    }
    expect(rowStore.writes).toBeGreaterThanOrEqual(1);
  });

  it('retries a failed batch on the next flush', async () => {
    const rowStore = new MemoryRowStore();
    const errors: unknown[] = [];
    const plugin = new RowPersistPlugin(rowStore, { flushDelayMs: 10, onError: (e) => errors.push(e) });
    const { store$ } = makeStore(rowStore, plugin);

    const original = rowStore.writeAsync.bind(rowStore);
    jest.spyOn(rowStore, 'writeAsync').mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    store$.items['a'].set({ id: 'a', name: 'Milk', is_checked: false });
    await jest.advanceTimersByTimeAsync(0);
    await plugin.flush();
    expect(errors).toHaveLength(1);
    expect(rowStore.tables.get('test.items')).toBeUndefined();

    (rowStore.writeAsync as jest.Mock).mockImplementation(original);
    await plugin.flush();
    expect(rowStore.tables.get('test.items')!.has('a')).toBe(true);
  });
});
