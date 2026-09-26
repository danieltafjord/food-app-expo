import type * as AuthSession from 'expo-auth-session';
import { router, usePathname } from 'expo-router';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import { apiRequest, isTransientError, setRequestLocaleSource, type RequestOptions } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { queryClient } from '@/lib/api/query-client';
import { SessionController, type SignOutReason } from '@/lib/auth/session-controller';
import { deferHouseholdSetup, setupAccount, type AccountSetupPhase } from '@/lib/auth/account-setup';
import { refreshSession, tokenResponseToSession } from '@/lib/auth/oauth';
import {
  clearSession,
  loadSession,
  saveSession,
} from '@/lib/auth/token-storage';
import { applyServerHouseholdSettings, applyServerSettings, getHouseholdDefaultServings, store$ } from '@/lib/store';
import { bindAccount, getBoundAccountId, resetLocalDataForAccount } from '@/lib/store/account';
import { whenHydrated } from '@/lib/store/persistence';
import { getDeviceLocale, isLocale, translate, type Locale } from '@/lib/i18n';
import { pushTokenForSignOut } from '@/lib/notifications/native';
import { startRealtime, stopRealtime } from '@/lib/realtime/live';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import { connectCollections, disconnectCollections, setSyncHooks, syncNow } from '@/lib/sync/engine';
import { resetSyncStatus } from '@/lib/sync/status';

type SessionContextValue = {
  /** True while the stored session is being restored on launch. */
  isLoading: boolean;
  /** True once we hold tokens (drives route guards). */
  isAuthenticated: boolean;
  /**
   * The signed-in user, from `/me` — or, right after launch, as `/me` last
   * returned it, so the app (and sync) work offline. Null until known.
   */
  user: User | null;
  setupPhase: AccountSetupPhase;
  retrySetup: () => void;
  /** Persist tokens from a completed OAuth flow; account setup follows navigation. */
  signIn: (token: AuthSession.TokenResponse) => Promise<void>;
  /** Revoke the current token (best effort) and clear local state. */
  signOut: () => Promise<void>;
  /** Re-fetch `/me`. */
  refreshUser: () => Promise<void>;
  /** Authorized request against `/api/v1` with proactive + reactive token refresh. */
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/** A stalled `/me` must become a retry, never an endless spinner. */
const USER_TIMEOUT_MS = 20_000;
/** Offline retries of `/me`: ~5 s, doubling, capped at 5 min. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
/** A `/me` younger than this is fresh enough to skip re-fetching. */
const USER_FRESH_MS = 60_000;
/** Returning to the front re-fetches `/me` at most this often (sooner after a failure). */
const REVALIDATE_MS = 5 * 60_000;

function retryDelay(attempt: number): number {
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
  return backoff + backoff * 0.25 * Math.random();
}

function appLocale(): Locale {
  const stored = store$.settings.locale.peek();
  return isLocale(stored) ? stored : getDeviceLocale();
}

// Server messages (validation, conflicts) come back in the app's language.
setRequestLocaleSource(appLocale);

/** The server ended the session (refresh token revoked or expired): say so, once. */
function tellSessionExpired(): void {
  const locale = appLocale();
  Alert.alert(translate(locale, 'session.expiredTitle'), translate(locale, 'session.expiredMessage'), [
    { text: translate(locale, 'session.later'), style: 'cancel' },
    { text: translate(locale, 'session.signInAgain'), onPress: () => router.push('/sign-in') },
  ]);
}

/**
 * The sync engine found changes for a household this account has left. They
 * can never upload; ask before discarding them.
 */
function confirmDiscardStranded(pending: number): Promise<boolean> {
  const locale = appLocale();
  return new Promise((resolve) => {
    Alert.alert(
      translate(locale, 'sync.householdGoneTitle'),
      translate(locale, pending === 1 ? 'sync.householdGoneMessageOne' : 'sync.householdGoneMessage', { count: pending }),
      [
        { text: translate(locale, 'sync.householdGoneKeep'), style: 'cancel', onPress: () => resolve(false) },
        { text: translate(locale, 'sync.householdGoneDiscard'), style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [setupPhase, setSetupPhase] = useState<AccountSetupPhase>('setting-up');
  const [setupAttempt, setSetupAttempt] = useState(0);
  const deferSetup = deferHouseholdSetup(usePathname());
  const userLoad = useRef(0);
  /** When `/me` last answered (epoch ms). */
  const userLoadedAt = useRef(0);
  const setupRetries = useRef(0);
  const needsSetup = !user?.current_household;
  const [sessionRevision, setSessionRevision] = useState(0);
  // Bumped when the local data was re-bound to another account (sync restarts
  // on the fresh copy) and when live sync must restart for a new household.
  const [accountRevision, setAccountRevision] = useState(0);
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const refreshUserRef = useRef<() => Promise<void>>(async () => undefined);
  const [controller] = useState(() => new SessionController({
    save: saveSession,
    clear: clearSession,
    refresh: refreshSession,
    request: apiRequest,
    onChange: (session) => {
      if (!session) {
        stopRealtime();
        setSyncAuth(null);
        disconnectCollections();
        resetSyncStatus();
        queryClient.clear();
        setUser(null);
        setSetupPhase('setting-up');
      }
      setSessionRevision((revision) => revision + 1);
      setIsAuthenticated(session !== null);
      setIsLoading(false);
    },
    onSignedOut: (reason: SignOutReason) => {
      store$.meta.cachedUser.set(null);
      if (reason === 'expired') tellSessionExpired();
    },
  }));

  function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return controller.request<T>(path, options);
  }

  /**
   * Take in a fresh `/me`. The local data must belong to this account before
   * anything syncs: sign-in binds it up front, but a restored session never
   * went through sign-in. Unbound data is claimed; data bound to another
   * account is wiped (it is safe on the server under that account) — with
   * sync stopped first, then restarted on the fresh copy.
   */
  function adoptUser(me: User): void {
    const bound = getBoundAccountId();
    if (bound === null) {
      bindAccount(me.id);
    } else if (bound !== me.id) {
      stopRealtime();
      setSyncAuth(null);
      disconnectCollections();
      resetSyncStatus();
      resetLocalDataForAccount(me.id);
      setAccountRevision((revision) => revision + 1);
    }
    store$.meta.cachedUser.set(me);
    userLoadedAt.current = Date.now();
    setUser(me);
    // Adopt the account's saved theme + language so a signed-in device matches
    // the user's preferences (local-first store stays the source of truth).
    applyServerSettings(me.theme, me.locale);
    // Adopt the active household's shared default servings (null when the user
    // hasn't joined a household yet — the local value is then kept).
    applyServerHouseholdSettings(me.current_household?.default_servings);
  }

  async function refreshUser(): Promise<void> {
    const load = ++userLoad.current;
    const revision = controller.revision;
    let me: User;
    try {
      me = await request<User>('/me');
    } catch (error) {
      if (revision === controller.revision && load === userLoad.current && needsSetup) {
        setSetupPhase(isTransientError(error) ? 'offline' : 'error');
      }
      throw error;
    }
    if (revision !== controller.revision || load !== userLoad.current) return;
    adoptUser(me);
    if (me.current_household) {
      setSetupPhase('ready');
    } else {
      setSetupAttempt((attempt) => attempt + 1);
    }
  }

  // The sync engine and live sync call back into the latest render's refresh.
  useEffect(() => {
    refreshUserRef.current = refreshUser;
  });

  async function signIn(token: AuthSession.TokenResponse): Promise<void> {
    store$.meta.cachedUser.set(null);
    await controller.set(tokenResponseToSession(token));
  }

  async function signOut(): Promise<void> {
    // After a cold start nothing has registered the push token in memory yet;
    // without it the server can't forget this install and keeps pushing the
    // previous account's household here.
    const pushToken = await pushTokenForSignOut();
    await controller.signOut(pushToken ? { push_token: pushToken } : undefined);
  }

  // Restore a persisted session on launch. We unblock routing as soon as the
  // tokens are read. The account as `/me` last returned it comes back with
  // them, so an offline launch knows the account and its household at once
  // and sync resumes; `/me` is then re-fetched in the background (see below).
  // An invalid token self-clears in request().
  useEffect(() => {
    let active = true;
    const revision = controller.revision;
    (async () => {
      let stored: Awaited<ReturnType<typeof loadSession>> = null;
      try {
        stored = await loadSession();
        if (stored) await whenHydrated;
      } catch {
        stored = null;
      }
      if (!active || controller.revision !== revision) {
        return;
      }
      if (stored) {
        const cached = store$.meta.cachedUser.peek();
        // `set` resets the user synchronously (no persistence to wait for);
        // the cached one goes in right after, in the same render batch.
        const restored = controller.set(stored, false);
        if (cached && cached.id === getBoundAccountId()) {
          setUser(cached);
          setSetupPhase(cached.current_household ? 'ready' : 'setting-up');
        }
        await restored;
      }
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
    // `controller` never changes (created once in state): this runs once. Listing
    // it instead of silencing the rule keeps the React Compiler optimizing this
    // provider, so its context value stays the same object across navigations
    // (`usePathname` re-renders it on each one) and consumers don't re-render.
  }, [controller]);

  // No household known yet: fetch the account and provision its first one.
  // Offline is not a failure — it retries by itself with backoff and when the
  // app returns to the front. A server refusal shows the retryable error; a
  // 401 has already signed out in request().
  useEffect(() => {
    if (!isAuthenticated || !needsSetup) return;
    const load = ++userLoad.current;
    const abort = new AbortController();
    const revision = controller.revision;
    let timedOut = false;
    let offline = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const isLive = () => revision === controller.revision && load === userLoad.current;
    const isCurrent = () => !abort.signal.aborted && isLive();
    const retry = () => setSetupAttempt((attempt) => attempt + 1);
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, USER_TIMEOUT_MS);
    void (async () => {
      await whenHydrated;
      if (!isCurrent()) return;
      // Retries while offline keep the calm offline state instead of flickering.
      setSetupPhase((phase) => (phase === 'offline' ? phase : 'setting-up'));
      const me = await setupAccount((path, options) => controller.request(path, options), {
        defer: deferSetup,
        name: translate(appLocale(), 'household.localDefaultName'),
        defaultServings: getHouseholdDefaultServings(),
        excludedIngredients: store$.households[store$.meta.localHouseholdId.get()].excluded_ingredients.get() ?? [],
        signal: abort.signal,
      });
      if (!isCurrent()) return;
      setupRetries.current = 0;
      adoptUser(me);
      setSetupPhase(me.current_household ? 'ready' : 'invitation');
      void queryClient.invalidateQueries();
    })().catch((error: unknown) => {
      if (!isLive() || (abort.signal.aborted && !timedOut)) return;
      if (timedOut || isTransientError(error)) {
        offline = true;
        setSetupPhase('offline');
        retryTimer = setTimeout(retry, retryDelay(setupRetries.current++));
      } else {
        setSetupPhase('error');
      }
    }).finally(() => clearTimeout(timer));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !offline) return;
      setupRetries.current = 0;
      retry();
    });
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearTimeout(retryTimer);
      subscription.remove();
    };
  }, [controller, isAuthenticated, sessionRevision, deferSetup, setupAttempt, needsSetup]);

  // A household is known (possibly from the cache): keep the account fresh in
  // the background — after launch and on return to the front — quietly
  // retrying while offline. Losing the household sends it back to setup above.
  useEffect(() => {
    if (!isAuthenticated || needsSetup) return;
    const revision = controller.revision;
    let active = true;
    let running = false;
    let failed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const revalidate = async () => {
      if (running) return;
      running = true;
      clearTimeout(retryTimer);
      const load = ++userLoad.current;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), USER_TIMEOUT_MS);
      try {
        const me = await controller.request<User>('/me', { signal: abort.signal });
        if (!active || revision !== controller.revision || load !== userLoad.current) return;
        failed = false;
        attempt = 0;
        adoptUser(me);
      } catch (error) {
        if (!active || revision !== controller.revision || load !== userLoad.current) return;
        failed = true;
        if (isTransientError(error)) retryTimer = setTimeout(() => void revalidate(), retryDelay(attempt++));
      } finally {
        clearTimeout(timer);
        running = false;
      }
    };
    if (Date.now() - userLoadedAt.current >= USER_FRESH_MS) void revalidate();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (failed || Date.now() - userLoadedAt.current >= REVALIDATE_MS) {
        attempt = 0;
        void revalidate();
      }
    });
    return () => {
      active = false;
      clearTimeout(retryTimer);
      subscription.remove();
    };
  }, [controller, isAuthenticated, needsSetup, sessionRevision]);

  const canSync = isAuthenticated && !!user?.current_household;
  const userId = user?.id ?? null;
  useEffect(() => {
    if (canSync) {
      setSyncHooks({
        // Removed from the household, or none active: let setup sort it out.
        onNoActiveHousehold: () => void refreshUserRef.current().catch(() => undefined),
        confirmDiscard: confirmDiscardStranded,
      });
      setSyncAuth((path, options) => controller.request(path, options));
      void connectCollections().then(() => syncNow()).catch(() => undefined);
    }
    return () => {
      setSyncHooks({});
      setSyncAuth(null);
      disconnectCollections();
    };
  }, [controller, canSync, sessionRevision, accountRevision]);

  // After the sync effect, which installs the request live sync authorizes with.
  useEffect(() => {
    if (!canSync) return;
    void startRealtime({
      userId,
      // This account was removed from the household: re-fetch the account (a
      // new household, or setup), then sync settles the rest (a 409 re-binds).
      onRemovedFromHousehold: () => {
        void refreshUserRef.current()
          .then(() => syncNow())
          .catch(() => undefined)
          .finally(() => setRealtimeRevision((revision) => revision + 1));
      },
    });
    return () => stopRealtime();
  }, [canSync, userId, sessionRevision, accountRevision, realtimeRevision]);

  const value: SessionContextValue = {
    isLoading,
    isAuthenticated,
    user,
    setupPhase,
    retrySetup: () => {
      setupRetries.current = 0;
      setSetupAttempt((attempt) => attempt + 1);
    },
    signIn,
    signOut,
    refreshUser,
    request,
  };

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const context = use(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
