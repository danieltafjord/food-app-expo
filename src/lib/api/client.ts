import { API_V1_URL } from '@/lib/config';

export type ValidationErrors = Record<string, string[]>;

/** Thrown for any non-2xx response. Carries the parsed body when there is one. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: ValidationErrors,
    public readonly body?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Convenience for `422` handling in forms. */
  get isValidation(): boolean {
    return this.status === 422;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  method?: HttpMethod;
  /** Serialized as JSON, except `FormData`, which is sent as multipart. Omit for GET/DELETE. */
  body?: unknown;
  /** Bearer token; the session layer injects a valid one. */
  accessToken?: string | null;
  signal?: AbortSignal;
};

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function hasKey<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

/**
 * Low-level request against `/api/v1`. Sets auth + JSON headers, unwraps the
 * `{ data }` envelope, returns `undefined` for `204`, and throws `ApiError`
 * for non-2xx. Knows nothing about refresh — the session layer wraps this.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, accessToken, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_V1_URL}${path}`, {
    method,
    headers,
    body: multipart ? body : body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const message = hasKey(payload, 'message') && typeof payload.message === 'string'
      ? payload.message
      : `Request failed with status ${response.status}`;
    const errors = hasKey(payload, 'errors') ? (payload.errors as ValidationErrors) : undefined;
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs = retryAfter == null ? undefined : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    throw new ApiError(response.status, message, errors, payload,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
  }

  if (hasKey(payload, 'data')) {
    return payload.data as T;
  }
  return payload as T;
}
