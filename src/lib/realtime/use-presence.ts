import { useValue } from '@legendapp/state/react';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { joinPresence, presence$, type PresenceMember } from './live';

/**
 * How long we stay listed after the screen loses focus while still mounted:
 * a sheet over it (adding items, editing a dinner) or a quick look at another
 * tab. You are still "in" the list then.
 */
const BLUR_LINGER_MS = 60_000;
/** After leaving the screen for good; only enough to ride out a quick back-and-forth. */
const LEAVE_LINGER_MS = 1500;

const NOBODY: PresenceMember[] = [];

/**
 * Show this user in `scope` while the screen is focused, and return everyone
 * else who has it open. Empty without live sync.
 */
export function usePresence(scope: string | null | undefined): PresenceMember[] {
  const mounted = useRef(true);
  const current = useRef(scope);
  useEffect(() => {
    current.current = scope;
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!scope) return;
      const handle = joinPresence(scope);
      // Focus cleanup also runs on unmount and when the scope changes (another
      // week); wait a tick to tell which it was. Only a blur lingers long.
      return () => {
        setTimeout(() => {
          const blurred = mounted.current && current.current === scope;
          handle.release(blurred ? BLUR_LINGER_MS : LEAVE_LINGER_MS);
        }, 0);
      };
    }, [scope]),
  );

  return useValue(() => (scope ? presence$[scope].get() : undefined)) ?? NOBODY;
}
