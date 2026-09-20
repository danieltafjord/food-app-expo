
import { pushOnce } from '@/lib/navigation';
import type { LocalIngredient } from '@/lib/store';

/**
 * Hand a result back from a sheet route to the screen that opened it.
 *
 * Sheets are native form-sheet routes (see `src/app/sheets/*` and the root
 * layout), so they can't receive callbacks through props like an inline
 * component would. Most sheets don't need to: they act on the store directly
 * and the opening screen re-renders reactively. The one exception is the
 * ingredient picker, whose pick lands in the dinner editor's *unsaved* draft —
 * so the editor registers a callback here and passes the request id as a route
 * param. Callbacks live in memory only: after a reload the sheet simply closes.
 */
type Resolver<T> = (value: T) => void;

let nextRequestId = 1;
const pending = new Map<string, Resolver<unknown>>();

function requestSheet<T>(resolve: Resolver<T>): string {
  const id = String(nextRequestId++);
  pending.set(id, resolve as Resolver<unknown>);
  return id;
}

/** Deliver a sheet's result (if the opener is still waiting) and forget the request. */
export function resolveSheet<T>(requestId: string | undefined, value: T): void {
  if (!requestId) return;
  const resolve = pending.get(requestId);
  pending.delete(requestId);
  resolve?.(value);
}

/** Forget a request without a result (the sheet was dismissed). */
export function cancelSheet(requestId: string | undefined): void {
  if (requestId) pending.delete(requestId);
}

/** What the ingredient picker returns: the ingredient plus any amount typed with it. */
export type IngredientPick = {
  ingredient: LocalIngredient;
  quantity: number | null;
  unit: string | null;
};

/** Open the ingredient picker sheet; `onPick` runs when the user chooses one. */
export function openIngredientPicker(onPick: (pick: IngredientPick) => void): void {
  const request = requestSheet(onPick);
  // The request id is new on every call, so name the destination for the
  // double-tap check — and release the callback if the push was dropped.
  const pushed = pushOnce(
    { pathname: '/sheets/ingredient-picker', params: { request } },
    '/sheets/ingredient-picker',
  );
  if (!pushed) cancelSheet(request);
}
