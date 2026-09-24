import type { LocalShoppingListItem } from './schema';

/**
 * Where an archived list's items live on the device: a table the store does
 * not load at launch, so a household's shopping history stops costing launch
 * time and memory. The list row itself stays in the store (with its
 * `archived_at`) and keeps syncing; its items are unchanged, only kept here
 * until the list is restored or deleted.
 *
 * The backend is injected: `persistence.ts` wires a table in the store's
 * SQLite database, tests use the in-memory one.
 */
export type ArchiveBackend = {
  /** Keep these items for the list (replacing any with the same id). */
  stash(listId: string, items: readonly LocalShoppingListItem[]): void;
  read(listId: string): LocalShoppingListItem[];
  /** Forget everything kept for these lists. */
  drop(listIds: readonly string[]): void;
  /** Forget these items wherever they are kept (deleted on another device). */
  forgetItems(itemIds: readonly string[]): void;
  /** Lists with items kept here. */
  listIds(): string[];
  counts(): Record<string, { total: number; checked: number }>;
};

export class MemoryArchive implements ArchiveBackend {
  readonly lists = new Map<string, Map<string, LocalShoppingListItem>>();

  stash(listId: string, items: readonly LocalShoppingListItem[]): void {
    const kept = this.lists.get(listId) ?? new Map<string, LocalShoppingListItem>();
    for (const item of items) kept.set(item.id, { ...item });
    this.lists.set(listId, kept);
  }

  read(listId: string): LocalShoppingListItem[] {
    return [...(this.lists.get(listId)?.values() ?? [])].map((item) => ({ ...item }));
  }

  drop(listIds: readonly string[]): void {
    for (const id of listIds) this.lists.delete(id);
  }

  forgetItems(itemIds: readonly string[]): void {
    for (const kept of this.lists.values()) {
      for (const id of itemIds) kept.delete(id);
    }
  }

  listIds(): string[] {
    return [...this.lists.keys()].filter((id) => (this.lists.get(id)?.size ?? 0) > 0);
  }

  counts(): Record<string, { total: number; checked: number }> {
    const counts: Record<string, { total: number; checked: number }> = {};
    for (const [listId, kept] of this.lists) {
      const items = [...kept.values()];
      counts[listId] = { total: items.length, checked: items.filter((item) => item.is_checked).length };
    }
    return counts;
  }
}

let backend: ArchiveBackend = new MemoryArchive();
let flushStore: () => Promise<void> = async () => undefined;

/**
 * Install the device backend, and how to wait for pending store writes to
 * reach disk (restored items are only forgotten here once they have).
 */
export function setArchiveBackend(next: ArchiveBackend, flush: () => Promise<void>): void {
  backend = next;
  flushStore = flush;
}

export function archive(): ArchiveBackend {
  return backend;
}

export function flushStoreWrites(): Promise<void> {
  return flushStore();
}
