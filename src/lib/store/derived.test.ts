import { observable } from '@legendapp/state';

import { derived, derivedById } from './derived';

/**
 * A computed that hands back its previous result must not notify: `useValue`
 * treats any notification carrying an object as a change and re-renders.
 */
it('does not notify when a derived value returns its cached result', () => {
  const source$ = observable({ shown: 1, unrelated: 1 });
  let cached: { shown: number } | undefined;
  const view$ = derived(() => {
    const shown = source$.shown.get();
    source$.unrelated.get();
    if (cached?.shown !== shown) cached = { shown };
    return cached;
  });
  const listener = jest.fn();
  view$.onChange(listener);
  view$.get();

  source$.unrelated.set(2);
  expect(listener).not.toHaveBeenCalled();

  source$.shown.set(2);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(view$.get()).toEqual({ shown: 2 });
});

it('does the same for per-id derived values, and still passes primitives through', () => {
  const source$ = observable({ count: 0, unrelated: 0 });
  const cache = new Map<string, number[]>();
  const view = derivedById((id) => {
    source$.unrelated.get();
    const next = [source$.count.get()];
    const previous = cache.get(id);
    if (previous && previous[0] === next[0]) return previous;
    cache.set(id, next);
    return next;
  });
  const count = derived(() => source$.count.get() * 2);
  const listener = jest.fn();
  view('a').onChange(listener);
  view('a').get();

  source$.unrelated.set(1);
  expect(listener).not.toHaveBeenCalled();
  source$.count.set(3);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(count.get()).toBe(6);
});
