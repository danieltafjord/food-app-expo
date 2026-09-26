import { ApiError, type RequestOptions } from '@/lib/api/client';
import type { StoredSession } from './token-storage';

type Dependencies = {
  save: (session: StoredSession) => Promise<void>;
  clear: () => Promise<void>;
  refresh: (token: string, signal?: AbortSignal) => Promise<StoredSession>;
  request: <T>(path: string, options: RequestOptions) => Promise<T>;
  onChange: (session: StoredSession | null) => void;
};

function isInvalidSession(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401;
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'invalid_grant' || error.code === 'invalid_token';
}

/** Owns token rotation independently of React, including in-flight session changes. */
export class SessionController {
  private session: StoredSession | null = null;
  private generation = 0;
  private refreshing: Promise<StoredSession> | null = null;
  private persistence: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: Dependencies) {}

  get revision(): number { return this.generation; }

  private assertCurrent(revision: number): void {
    if (revision !== this.generation || !this.session) {
      throw new ApiError(401, 'Session changed');
    }
  }

  private persist(operation: () => Promise<void>): Promise<void> {
    const pending = this.persistence.catch(() => undefined).then(operation);
    this.persistence = pending;
    return pending;
  }

  async set(session: StoredSession | null, persist = true): Promise<void> {
    const revision = ++this.generation;
    this.session = session;
    this.refreshing = null;
    // Invalidate queries and stop sync immediately, before any Keychain I/O.
    this.dependencies.onChange(null);
    if (persist) {
      try {
        await this.persist(() => session
          ? this.dependencies.save(session)
          : this.dependencies.clear());
      } catch (error) {
        if (revision === this.generation) {
          this.session = null;
          this.generation += 1;
        }
        throw error;
      }
    }
    if (revision === this.generation && session) this.dependencies.onChange(session);
  }

  private refresh(revision: number): Promise<StoredSession> {
    this.assertCurrent(revision);
    if (this.refreshing) return this.refreshing;
    const token = this.session?.refreshToken;
    if (!token) return Promise.reject(new ApiError(401, 'Session expired'));

    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError(503, 'Session refresh timed out. Please retry.'));
        abort.abort();
      }, 15_000);
    });
    const pending = Promise.race([this.dependencies.refresh(token, abort.signal), timeout]).then(async (next) => {
      this.assertCurrent(revision);
      this.session = next;
      await this.persist(() => this.dependencies.save(next));
      this.assertCurrent(revision);
      return next;
    }).catch(async (error: unknown) => {
      if (revision === this.generation && isInvalidSession(error)) await this.set(null);
      throw error;
    }).finally(() => {
      clearTimeout(timer);
      if (this.refreshing === pending) this.refreshing = null;
    });
    this.refreshing = pending;
    return pending;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.signal?.aborted) throw abortError();
    const revision = this.generation;
    this.assertCurrent(revision);
    let session = this.session!;
    if (session.refreshToken && session.expiresAt != null && session.expiresAt - 60_000 <= Date.now()) {
      session = await abortable(this.refresh(revision), options.signal);
    }
    this.assertCurrent(revision);
    try {
      const result = await this.dependencies.request<T>(path, { ...options, accessToken: session.accessToken });
      this.assertCurrent(revision);
      return result;
    } catch (error) {
      this.assertCurrent(revision);
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!this.session?.refreshToken) {
        await this.set(null);
        throw error;
      }
      // Another request may already have rotated the rejected access token.
      const refreshed = this.session.accessToken !== session.accessToken
        ? this.session
        : await abortable(this.refresh(revision), options.signal);
      this.assertCurrent(revision);
      try {
        const result = await this.dependencies.request<T>(path, { ...options, accessToken: refreshed.accessToken });
        this.assertCurrent(revision);
        return result;
      } catch (retryError) {
        if (revision === this.generation && isInvalidSession(retryError)) await this.set(null);
        throw retryError;
      }
    }
  }

  /** `body` rides along on the logout request (the install's push token, so the server forgets it). */
  async signOut(body?: Record<string, unknown>): Promise<void> {
    const accessToken = this.session?.accessToken;
    await this.set(null);
    if (!accessToken) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      await this.dependencies.request('/auth/logout', { method: 'POST', accessToken, body, signal: controller.signal });
    } catch {
      // Revocation is best effort when offline; local credentials are already removed.
    } finally {
      clearTimeout(timeout);
    }
  }
}

function abortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

/** Cancelling one request must not cancel a refresh shared by other callers. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
