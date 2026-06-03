import type * as AuthSession from 'expo-auth-session';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';

import { ApiError, apiRequest, type RequestOptions } from '@/lib/api/client';
import type { User } from '@/lib/api/types';
import { refreshSession, tokenResponseToSession } from '@/lib/auth/oauth';
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession,
} from '@/lib/auth/token-storage';
import { applyServerSettings } from '@/lib/store';
import { setSyncAuth } from '@/lib/sync/auth-bridge';
import { connectCollections, disconnectCollections } from '@/lib/sync/engine';

/** Refresh this many ms before the access token actually expires. */
const EXPIRY_SKEW_MS = 60_000;

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
  const tokensRef = useRef<StoredSession | null>(null);
  const refreshInFlight = useRef<Promise<StoredSession> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  async function applyTokens(session: StoredSession | null): Promise<void> {
    tokensRef.current = session;
    if (session) {
      await saveSession(session);
      setIsAuthenticated(true);
    } else {
      await clearSession();
      setIsAuthenticated(false);
      setUser(null);
    }
  }

  /** Clear local session without hitting the API (used when the token is already dead). */
  async function forceSignOut(): Promise<void> {
    await applyTokens(null);
  }

  /** Single-flight refresh: concurrent callers share one network round-trip. */
  function refreshTokens(): Promise<StoredSession> {
    if (!refreshInFlight.current) {
      const current = tokensRef.current;
      if (!current?.refreshToken) {
        return Promise.reject(new ApiError(401, 'Session expired'));
      }
      refreshInFlight.current = refreshSession(current.refreshToken)
        .then(async (next) => {
          tokensRef.current = next;
          await saveSession(next);
          return next;
        })
        .finally(() => {
          refreshInFlight.current = null;
        });
    }
    return refreshInFlight.current;
  }

  async function getValidAccessToken(): Promise<string> {
    const current = tokensRef.current;
    if (!current) {
      throw new ApiError(401, 'Not authenticated');
    }
    const expiringSoon =
      current.expiresAt != null && current.expiresAt - EXPIRY_SKEW_MS <= Date.now();
    if (expiringSoon && current.refreshToken) {
      const refreshed = await refreshTokens();
      return refreshed.accessToken;
    }
    return current.accessToken;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const accessToken = await getValidAccessToken();
    try {
      return await apiRequest<T>(path, { ...options, accessToken });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
      // Stale token: try a single refresh + retry, otherwise sign out.
      if (tokensRef.current?.refreshToken) {
        try {
          const refreshed = await refreshTokens();
          return await apiRequest<T>(path, { ...options, accessToken: refreshed.accessToken });
        } catch {
          await forceSignOut();
          throw error;
        }
      }
      await forceSignOut();
      throw error;
    }
  }

  async function refreshUser(): Promise<void> {
    const me = await request<User>('/me');
    setUser(me);
    // Adopt the account's saved theme + language so a signed-in device matches
    // the user's preferences (local-first store stays the source of truth).
    applyServerSettings(me.theme, me.locale);
  }

  async function signIn(token: AuthSession.TokenResponse): Promise<void> {
    await applyTokens(tokenResponseToSession(token));
    await refreshUser();
  }

  async function signOut(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // Token may already be invalid; clearing locally is what matters.
    }
    await applyTokens(null);
  }

  // Restore a persisted session on launch. We unblock routing as soon as the
  // tokens are read; the user is then fetched in the background so we never hold
  // the splash on a network round-trip. An invalid token self-clears in request().
  useEffect(() => {
    let active = true;
    (async () => {
      let stored: StoredSession | null = null;
      try {
        stored = await loadSession();
      } catch {
        stored = null;
      }
      if (!active) {
        return;
      }
      if (stored) {
        tokensRef.current = stored;
        setIsAuthenticated(true);
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

  // Start/stop cloud sync with the session. `request` is stable across renders
  // (it reads mutable refs), so capturing it on the auth transition is safe.
  useEffect(() => {
    if (isAuthenticated) {
      setSyncAuth(request);
      void connectCollections();
    } else {
      setSyncAuth(null);
      disconnectCollections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

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
