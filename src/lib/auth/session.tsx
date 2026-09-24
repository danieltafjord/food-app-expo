import type * as AuthSession from 'expo-auth-session';
import { usePathname } from 'expo-router';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';

import { apiRequest, type RequestOptions } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { queryClient } from '@/lib/api/query-client';
import { SessionController } from '@/lib/auth/session-controller';
import { deferHouseholdSetup, setupAccount, type AccountSetupPhase } from '@/lib/auth/account-setup';
import { refreshSession, tokenResponseToSession } from '@/lib/auth/oauth';
import {
  clearSession,
  loadSession,
  saveSession,
} from '@/lib/auth/token-storage';
import { applyServerHouseholdSettings, applyServerSettings, getHouseholdDefaultServings, store$ } from '@/lib/store';
import { whenHydrated } from '@/lib/store/persistence';
import { getDeviceLocale, translate } from '@/lib/i18n';
import { startRealtime, stopRealtime } from '@/lib/realtime/live';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import { connectCollections, disconnectCollections, syncNow } from '@/lib/sync/engine';
import { resetSyncStatus } from '@/lib/sync/status';

type SessionContextValue = {
  /** True while the stored session is being restored on launch. */
  isLoading: boolean;
  /** True once we hold tokens (drives route guards). */
  isAuthenticated: boolean;
  /** The signed-in user, populated from `/me`. Null until loaded. */
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [setupPhase, setSetupPhase] = useState<AccountSetupPhase>('setting-up');
  const [setupAttempt, setSetupAttempt] = useState(0);
  const deferSetup = deferHouseholdSetup(usePathname());
  const userLoad = useRef(0);
  const needsSetup = !user?.current_household;
  const [sessionRevision, setSessionRevision] = useState(0);
  const [controller] = useState(() => new SessionController({
    save: saveSession,
    clear: clearSession,
    refresh: refreshSession,
    request: apiRequest,
    onChange: (session) => {
      if (!session) {
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
  }));

  function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return controller.request<T>(path, options);
  }

  async function refreshUser(): Promise<void> {
    const load = ++userLoad.current;
    const revision = controller.revision;
    let me: User;
    try {
      me = await request<User>('/me');
    } catch (error) {
      if (revision === controller.revision && load === userLoad.current && needsSetup) {
        setSetupPhase('error');
      }
      throw error;
    }
    if (revision !== controller.revision || load !== userLoad.current) return;
    setUser(me);
    if (me.current_household) {
      setSetupPhase('ready');
    } else {
      setSetupAttempt((attempt) => attempt + 1);
    }
    // Adopt the account's saved theme + language so a signed-in device matches
    // the user's preferences (local-first store stays the source of truth).
    applyServerSettings(me.theme, me.locale);
    // Adopt the active household's shared default servings (null when the user
    // hasn't joined a household yet — the local value is then kept).
    applyServerHouseholdSettings(me.current_household?.default_servings);
  }

  async function signIn(token: AuthSession.TokenResponse): Promise<void> {
    await controller.set(tokenResponseToSession(token));
  }

  async function signOut(): Promise<void> {
    await controller.signOut();
  }

  // Restore a persisted session on launch. We unblock routing as soon as the
  // tokens are read; the user is then fetched in the background so we never hold
  // the splash on a network round-trip. An invalid token self-clears in request().
  useEffect(() => {
    let active = true;
    const revision = controller.revision;
    (async () => {
      let stored: Awaited<ReturnType<typeof loadSession>> = null;
      try {
        stored = await loadSession();
      } catch {
        stored = null;
      }
      if (!active || controller.revision !== revision) {
        return;
      }
      if (stored) {
        await controller.set(stored, false);
        setIsLoading(false);
      } else {
        setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // `controller` never changes (created once in state): this runs once. Listing
    // it instead of silencing the rule keeps the React Compiler optimizing this
    // provider, so its context value stays the same object across navigations
    // (`usePathname` re-renders it on each one) and consumers don't re-render.
  }, [controller]);

  useEffect(() => {
    if (!isAuthenticated || !needsSetup) return;
    const load = ++userLoad.current;
    const abort = new AbortController();
    const revision = controller.revision;
    const isCurrent = () => !abort.signal.aborted && revision === controller.revision && load === userLoad.current;
    // A stalled request must become an actionable retry, never an endless spinner.
    const timer = setTimeout(() => {
      if (isCurrent()) setSetupPhase('error');
      abort.abort();
    }, 20_000);
    void (async () => {
      await whenHydrated;
      if (!isCurrent()) return;
      setSetupPhase('setting-up');
      const me = await setupAccount((path, options) => controller.request(path, options), {
        defer: deferSetup,
        name: translate(store$.settings.locale.get() || getDeviceLocale(), 'household.localDefaultName'),
        defaultServings: getHouseholdDefaultServings(),
        signal: abort.signal,
      });
      if (!isCurrent()) return;
      setUser(me);
      applyServerSettings(me.theme, me.locale);
      applyServerHouseholdSettings(me.current_household?.default_servings);
      setSetupPhase(me.current_household ? 'ready' : 'invitation');
      void queryClient.invalidateQueries();
    })().catch(() => {
      if (isCurrent()) setSetupPhase('error');
    }).finally(() => clearTimeout(timer));
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [controller, isAuthenticated, sessionRevision, deferSetup, setupAttempt, needsSetup]);

  const canSync = isAuthenticated && !!user?.current_household;
  useEffect(() => {
    if (canSync) {
      setSyncAuth((path, options) => controller.request(path, options));
      void connectCollections().then(() => syncNow()).catch(() => undefined);
      void startRealtime();
    }
    return () => {
      stopRealtime();
      setSyncAuth(null);
      disconnectCollections();
    };
  }, [controller, canSync, sessionRevision]);

  const value: SessionContextValue = {
    isLoading,
    isAuthenticated,
    user,
    setupPhase,
    retrySetup: () => setSetupAttempt((attempt) => attempt + 1),
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
