import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { aiSettingsKey, useAiSettings } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { runClassificationJob, classificationReady, aiRetryDelay } from '@/lib/ai-classification';
import { useSession } from '@/lib/auth/session';
import { store$ } from '@/lib/store/collections';
import { useLocale } from '@/lib/store/settings';

/** Optional enrichment never delays local writes or the normal sync loop. */
export function AiClassificationWorker() {
  const { user, request } = useSession();
  const { settings } = useAiSettings();
  const locale = useLocale();
  const client = useQueryClient();
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);
  const enabled = !!settings?.available && settings.email_verified && settings.categorization_enabled;
  const userId = user?.id;
  const householdId = user?.current_household?.id;

  useEffect(() => {
    if (!enabled || !userId || !householdId) return;
    const abort = new AbortController();
    for (const id of Object.keys(store$.meta.aiClassificationJobs.get())) {
      if (!store$.ingredients[id].get()) store$.meta.aiClassificationJobs[id].delete();
    }
    let timer: ReturnType<typeof setTimeout>;
    let nextAllowed = 0;
    async function tick() {
      let delay = 6000;
      try {
        if (AppState.currentState !== 'active' || Date.now() < nextAllowed) return;
        if (store$.meta.accountId.get() !== userId || store$.meta.serverHouseholdId.get() !== householdId) return;
        const ingredient = Object.values(store$.ingredients.get()).find((item) =>
          classificationReady(item, locale));
        if (!ingredient) return;
        await runClassificationJob(ingredient, requestRef.current, locale, abort.signal, () =>
          !abort.signal.aborted && !store$.settings.aiPaused.get()?.[String(userId)]?.categorization);
        void client.invalidateQueries({ queryKey: aiSettingsKey(userId, householdId) });
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 429, 503].includes(error.status)) {
          delay = aiRetryDelay(error);
          nextAllowed = Date.now() + delay;
        }
        if (!abort.signal.aborted) void client.invalidateQueries({ queryKey: aiSettingsKey(userId, householdId) });
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => { void tick(); }, delay);
      }
    }
    timer = setTimeout(() => { void tick(); }, 1500);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [enabled, userId, householdId, locale, client]);
  return null;
}
