import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

/**
 * Native tabs render every tab when the navigator mounts (the tab bar needs
 * each screen for its transitions), so launch used to build the Dinners list,
 * every shopping list and the account screen before the first frame of Plans.
 *
 * A deferred tab renders its content the first time it is focused, or — so a
 * later switch is still instant — once the app is idle after launch, one tab
 * per idle period rather than all of them in one long task. It stays mounted
 * afterwards, keeping its scroll position and state.
 */
export function useDeferredTab(): boolean {
  const [ready, setReady] = useState(false);
  useFocusEffect(useCallback(() => {
    setReady(true);
  }, []));
  useEffect(() => {
    if (ready) return;
    const mount = () => setReady(true);
    waiting.push(mount);
    scheduleNext();
    return () => {
      const index = waiting.indexOf(mount);
      if (index !== -1) waiting.splice(index, 1);
    };
  }, [ready]);
  return ready;
}

const waiting: (() => void)[] = [];
let scheduled = false;

const whenIdle: (callback: () => void) => void = typeof globalThis.requestIdleCallback === 'function'
  // The timeout bounds the wait while launch keeps the JS thread busy (a first sync).
  ? (callback) => globalThis.requestIdleCallback(callback, { timeout: 2000 })
  : (callback) => setTimeout(callback, 50);

function scheduleNext(): void {
  if (scheduled || waiting.length === 0) return;
  scheduled = true;
  whenIdle(() => {
    scheduled = false;
    waiting.shift()?.();
    scheduleNext();
  });
}
