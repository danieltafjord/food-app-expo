import { batch } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';

import { archive, flushStoreWrites } from './archive';
import { store$ } from './collections';
import { derived } from './derived';
import { compareIso, nowIso } from './ids';
import type { LocalShoppingList, LocalShoppingListItem } from './schema';
import { deleteShoppingList } from './shopping-lists';
import { untracked } from './tracking';

/**
 * Archiving shopping lists.
 *
 * Nothing is deleted: an archived list leaves the lists screen, and its items
 * move out of the store into the archive table (`./archive`), which launch
 * never reads. The list row keeps syncing with its `archived_at`, so the
 * household sees the same lists archived on every device, and restoring one
 * (here or elsewhere) brings its items back.
 */

/** Finished lists (everything checked, or empty) untouched this long are archived automatically. */
export const AUTO_ARCHIVE_AFTER_DAYS = 30;

const archivedLists$ = derived((): LocalShoppingList[] =>
  Object.values(store$.shoppingLists.get())
    .filter((list) => list.archived_at)
    .sort((a, b) => compareIso(b.archived_at, a.archived_at)),
);

/** Archived lists, most recently archived first. */
export function useArchivedShoppingLists(): LocalShoppingList[] {
  return useValue(archivedLists$);
}

/** Item and checked counts of archived lists, read from the archive table. */
export function archivedItemCounts(): Record<string, { total: number; checked: number }> {
  return archive().counts();
}

export function archiveShoppingList(id: string): void {
  const list = store$.shoppingLists[id].peek();
  if (!list || list.archived_at) return;
  const ts = nowIso();
  store$.shoppingLists[id].assign({ archived_at: ts, updated_at: ts });
  settleArchive();
}

export function restoreShoppingList(id: string): void {
  if (!store$.shoppingLists[id].peek()?.archived_at) return;
  store$.shoppingLists[id].assign({ archived_at: null, updated_at: nowIso() });
  settleArchive();
}

/** For a device not synced to the cloud: remove every archived list for good. */
export function deleteArchivedShoppingLists(): void {
  const ids = Object.values(store$.shoppingLists.peek()).filter((list) => list.archived_at).map((list) => list.id);
  batch(() => {
    for (const id of ids) deleteShoppingList(id);
  });
}

/**
 * Archive finished lists nobody has touched for {@link AUTO_ARCHIVE_AFTER_DAYS}
 * days. A list with anything left to buy is never archived automatically.
 */
export function autoArchiveFinishedLists(now = Date.now()): number {
  const cutoff = new Date(now - AUTO_ARCHIVE_AFTER_DAYS * 86_400_000).toISOString();
  const lists = store$.shoppingLists.peek();
  const lastTouched = new Map<string, string>();
  const unfinished = new Set<string>();
  for (const item of Object.values(store$.shoppingListItems.peek())) {
    const listId = item.shopping_list_id;
    if (!item.is_checked) unfinished.add(listId);
    if (compareIso(item.updated_at, lastTouched.get(listId)) > 0) lastTouched.set(listId, item.updated_at);
  }
  const due = Object.values(lists).filter((list) => {
    if (list.archived_at || unfinished.has(list.id)) return false;
    const touched = compareIso(lastTouched.get(list.id), list.updated_at) > 0 ? lastTouched.get(list.id) : list.updated_at;
    return compareIso(touched, cutoff) < 0;
  });
  if (due.length === 0) return 0;
  const ts = nowIso();
  batch(() => {
    for (const list of due) store$.shoppingLists[list.id].assign({ archived_at: ts, updated_at: ts });
  });
  return due.length;
}

/**
 * Put every list's items where its archived state says they belong: out of
 * the store for an archived list, back in it for one restored (here or on
 * another device). Items with a change still waiting to sync stay in the
 * store for now — the outbox reads rows from it — and move on a later run:
 * this runs after every sync and once after launch.
 */
export function settleArchive(): void {
  const lists = store$.shoppingLists.peek();
  for (const listId of archive().listIds()) {
    const list = lists[listId];
    if (!list) archive().drop([listId]);
    else if (!list.archived_at) restoreItems(listId);
  }

  const meta = store$.meta.peek();
  const queued = (id: string) =>
    meta.dirty?.shoppingListItems?.[id] != null
    || meta.tombstones?.shoppingListItems?.[id] != null
    || meta.failed?.shoppingListItems?.[id] != null;
  const itemsByList = new Map<string, LocalShoppingListItem[]>();
  const waiting = new Set<string>();
  for (const item of Object.values(store$.shoppingListItems.peek())) {
    const listId = item.shopping_list_id;
    if (!lists[listId]?.archived_at || restoring.has(listId)) continue;
    if (queued(item.id)) waiting.add(listId);
    const items = itemsByList.get(listId);
    if (items) items.push(item);
    else itemsByList.set(listId, [item]);
  }
  for (const listId of waiting) itemsByList.delete(listId);
  if (itemsByList.size === 0) return;

  // Kept first, then removed from the store: interrupted in between, the next
  // run finds them in both places and simply does this again.
  for (const [listId, items] of itemsByList) archive().stash(listId, items);
  untracked(() => {
    for (const items of itemsByList.values()) {
      for (const item of items) store$.shoppingListItems[item.id].delete();
    }
  });
}

/** Lists whose kept items are being put back and not yet forgotten. */
const restoring = new Set<string>();

function restoreItems(listId: string): void {
  if (restoring.has(listId)) return;
  restoring.add(listId);
  const current = store$.shoppingListItems.peek();
  const missing = archive().read(listId).filter((item) => !current[item.id]);
  if (missing.length > 0) {
    untracked(() => {
      for (const item of missing) store$.shoppingListItems[item.id].set(item);
    });
  }
  // Forget the kept copy only once the restored rows are on disk; if the app
  // stops before that, the next launch restores from it again.
  void flushStoreWrites()
    .then(() => {
      if (!store$.shoppingLists[listId].peek()?.archived_at) archive().drop([listId]);
    })
    .catch(() => undefined)
    .finally(() => restoring.delete(listId));
}

/**
 * Bring every archived list's items back into the store. A device linking to
 * the cloud for the first time uploads what the store holds; its lists stay
 * archived and their items move out again after that sync.
 *
 * Only for lists the store still has: items kept for a list that is gone
 * (another account's or household's, from before a wipe) would upload as
 * orphans the server can only refuse. Those are forgotten instead.
 */
export function restoreAllArchivedItems(): void {
  const lists = store$.shoppingLists.peek();
  const orphaned: string[] = [];
  for (const listId of archive().listIds()) {
    if (lists[listId]) restoreItems(listId);
    else orphaned.push(listId);
  }
  if (orphaned.length > 0) archive().drop(orphaned);
}

/** Launch housekeeping: archive what is due and settle where items live. */
export function runArchiveMaintenance(): void {
  try {
    autoArchiveFinishedLists();
    settleArchive();
  } catch (error) {
    // The archive table can be busy while a store write is in flight; the
    // next sync or launch settles it.
    if (__DEV__) console.warn('[archive] maintenance failed', error);
  }
}
