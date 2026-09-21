import type * as AuthSession from 'expo-auth-session';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { apiRequest, type RequestOptions } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { queryClient } from '@/lib/api/query-client';
import { SessionController } from '@/lib/auth/session-controller';
import { refreshSession, tokenResponseToSession } from '@/lib/auth/oauth';
import {
  clearSession,
  loadSession,
  saveSession,
} from '@/lib/auth/token-storage';
import { applyServerHouseholdSettings, applyServerSettings } from '@/lib/store';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import { connectCollections, disconnectCollections } from '@/lib/sync/engine';

type SessionContextValue = {
  /** True while the stored session is being restored on launch. */
  isLoading: boolean;
  /** True once we hold tokens (drives route guards). */
  isAuthenticated: boolean;
  /** The signed-in user, populated from `/me`. Null until loaded. */
  user: User | null;
  /** Persist tokens from a completed OAuth flow and load the user. */
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
        queryClient.clear();
        setUser(null);
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
    const revision = controller.revision;
    const me = await request<User>('/me');
    if (revision !== controller.revision) return;
    setUser(me);
    // Adopt the account's saved theme + language so a signed-in device matches
    // the user's preferences (local-first store stays the source of truth).
    applyServerSettings(me.theme, me.locale);
    // Adopt the active household's shared default servings (null when the user
    // hasn't joined a household yet — the local value is then kept).
    applyServerHouseholdSettings(me.current_household?.default_servings);
  }

  async function signIn(token: AuthSession.TokenResponse): Promise<void> {
    await controller.set(tokenResponseToSession(token));
    await refreshUser();
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
        refreshUser().catch(() => {
          // 401s already cleared the session inside request(); ignore the rest.
        });
      } else {
        setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setSyncAuth((path, options) => controller.request(path, options));
      void connectCollections().catch(() => undefined);
    }
    return () => {
      setSyncAuth(null);
      disconnectCollections();
    };
  }, [controller, isAuthenticated, sessionRevision]);

  const value: SessionContextValue = {
    isLoading,
    isAuthenticated,
    user,
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
