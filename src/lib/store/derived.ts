import { observable, ObservableHint, type Observable } from '@legendapp/state';

/**
 * Derived read models as Legend-State computed observables.
 *
 * `useValue(() => derive())` re-runs the selector on EVERY render of the host
 * component (and on every store change) and hands out a fresh array each time,
 * so a keystroke in a search field re-joins and re-sorts the whole collection
 * and defeats every `useMemo` keyed on the result. A computed observable runs
 * lazily, caches its value until a tracked dependency changes, and returns the
 * same reference to every subscriber in between — so screens re-render only
 * when the derived data actually changed, and pay the join once per change.
 *
 * Computeds are module-level singletons; per-id ones (a list's items) are
 * created on first use and kept for the app's lifetime, which is bounded by the
 * number of lists/plans a household has.
 *
 * Results are marked plain: they are plain data, never observables or
 * functions. Without the hint Legend-State force-notifies whenever a computed
 * re-runs and returns an object — even the very same cached object — and
 * `useValue` re-renders on that, so caching a result by reference (see
 * `sectionsFor`) would not spare a single render.
 */
export function derivedById<T>(compute: (id: string) => T): (id: string) => Observable<T> {
  const cache = new Map<string, Observable<T>>();
  return (id) => {
    let computed$ = cache.get(id);
    if (!computed$) {
      computed$ = observable(() => plain(compute(id))) as Observable<T>;
      cache.set(id, computed$);
    }
    return computed$;
  };
}

/** A parameterless derived read model. */
export function derived<T>(compute: () => T): Observable<T> {
  return observable(() => plain(compute())) as Observable<T>;
}

function plain<T>(value: T): T {
  return value !== null && typeof value === 'object' ? ObservableHint.plain(value) : value;
}
