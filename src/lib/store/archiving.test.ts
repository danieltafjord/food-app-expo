import { archive, MemoryArchive, setArchiveBackend } from './archive';
import {
  archiveShoppingList,
  autoArchiveFinishedLists,
  deleteArchivedShoppingLists,
  restoreShoppingList,
  settleArchive,
  useArchivedShoppingLists,
} from './archiving';
import { store$ } from './collections';
import { addShoppingItem, createShoppingList, useShoppingListIds, useShoppingListSections } from './shopping-lists';

jest.mock('@legendapp/state/react', () => ({
  useValue: (read: (() => unknown) | { get: () => unknown }) => typeof read === 'function' ? read() : read.get(),
}));

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  setArchiveBackend(new MemoryArchive(), async () => undefined);
  store$.shoppingLists.set({});
  store$.shoppingListItems.set({});
  store$.meta.assign({ dirty: {}, tombstones: {}, failed: {} });
});

function listWithItems(name: string, items: string[]): string {
  const id = createShoppingList(name);
  for (const item of items) addShoppingItem(id, { name: item });
  return id;
}

it('moves an archived list out of the lists screen and its items out of the store, and back on restore', async () => {
  const kept = listWithItems('This week', ['Milk']);
  const old = listWithItems('Last week', ['Eggs', 'Rice']);

  archiveShoppingList(old);

  expect(useShoppingListIds()).toEqual([kept]);
  expect(useArchivedShoppingLists().map((list) => list.id)).toEqual([old]);
  expect(Object.values(store$.shoppingListItems.get()).map((item) => item.name)).toEqual(['Milk']);
  expect(archive().read(old).map((item) => item.name).sort()).toEqual(['Eggs', 'Rice']);

  restoreShoppingList(old);
  await settled();

  expect(useShoppingListIds().sort()).toEqual([kept, old].sort());
  expect(useShoppingListSections(old).total).toBe(2);
  expect(archive().listIds()).toEqual([]);
});

it('keeps items waiting to sync in the store until they have synced', () => {
  const id = listWithItems('Party', ['Chips']);
  const [item] = Object.keys(store$.shoppingListItems.get());
  store$.meta.dirty.set({ shoppingListItems: { [item]: true } });

  archiveShoppingList(id);
  expect(store$.shoppingListItems[item].get()).toBeDefined();

  store$.meta.dirty.set({});
  settleArchive();
  expect(store$.shoppingListItems[item].get()).toBeUndefined();
  expect(archive().read(id)).toHaveLength(1);
});

it('archives finished lists nobody touched for 30 days, and nothing with items left to buy', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  const old = '2026-08-01T12:00:00.000Z';
  const done = listWithItems('Done', ['Milk']);
  const unfinished = listWithItems('Unfinished', ['Milk', 'Bread']);
  const empty = createShoppingList('Empty');
  const recent = listWithItems('Recent', ['Tea']);
  for (const item of Object.values(store$.shoppingListItems.peek())) {
    const isChecked = item.shopping_list_id !== unfinished || item.name === 'Milk';
    const updatedAt = item.shopping_list_id === recent ? '2026-09-20T12:00:00.000Z' : old;
    store$.shoppingListItems[item.id].assign({ is_checked: isChecked, updated_at: updatedAt });
  }
  for (const id of [done, unfinished, empty, recent]) store$.shoppingLists[id].updated_at.set(old);

  expect(autoArchiveFinishedLists(now)).toBe(2);
  expect(useArchivedShoppingLists().map((list) => list.id).sort()).toEqual([done, empty].sort());
});

it('deletes every archived list and what was kept for it', () => {
  const kept = listWithItems('Keep', ['Milk']);
  const gone = listWithItems('Gone', ['Eggs']);
  archiveShoppingList(gone);

  deleteArchivedShoppingLists();

  expect(Object.keys(store$.shoppingLists.get())).toEqual([kept]);
  expect(archive().listIds()).toEqual([]);
});
