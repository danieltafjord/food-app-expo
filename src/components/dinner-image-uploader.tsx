import { useValue } from '@legendapp/state/react';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { sweepPendingFiles, uploadPendingImages } from '@/lib/dinner-image-upload';
import { useSession } from '@/lib/auth/session';
import { store$ } from '@/lib/store/collections';

/**
 * Uploads photos picked on this device once it is signed in and bound to the
 * account's active household (a picture can only attach to dinners of the
 * household it was uploaded to). Local edits never wait for it.
 */
export function DinnerImageUploader() {
  const { user, request } = useSession();
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  const pendingCount = useValue(() => Object.keys(store$.meta.pendingImages.get() ?? {}).length);
  const boundAccount = useValue(store$.meta.accountId);
  const boundHousehold = useValue(store$.meta.serverHouseholdId);
  const ready = !!user && boundAccount === user.id && !!user.current_household && boundHousehold === user.current_household.id;

  useEffect(() => { sweepPendingFiles(); }, []);

  useEffect(() => {
    if (!ready || pendingCount === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      // Stopped in the background; the AppState listener below restarts it.
      if (AppState.currentState !== 'active') return;
      let delay: number | null = 30_000;
      try {
        delay = await uploadPendingImages(requestRef.current);
      } finally {
        if (!cancelled && delay != null) timer = setTimeout(() => { void tick(); }, delay);
      }
    }
    timer = setTimeout(() => { void tick(); }, 500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearTimeout(timer);
      timer = setTimeout(() => { void tick(); }, 500);
    });
    return () => { cancelled = true; clearTimeout(timer); subscription.remove(); };
  }, [ready, pendingCount]);

  return null;
}
