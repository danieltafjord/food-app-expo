import { ApiError } from '@/lib/api/client';
import type { TFunction, TKey } from '@/lib/i18n';

/**
 * The message to show for a failed request. The server localizes what it says
 * (`Accept-Language`), so a message it wrote about the request itself — a 4xx
 * with a `message` or OAuth `hint` — is shown as is. Everything else reads in
 * the app's language: no connection (fetch throws a bare `TypeError`), a server
 * error, or the client's generic "Request failed with status N".
 */
export function errorMessage(error: unknown, t: TFunction, fallback: TKey = 'common.somethingWrong'): string {
  if (error instanceof ApiError) {
    const said = serverMessage(error);
    if (said) return said;
    if (error.status === 0 || error.status === 408) return t('common.networkError');
    return t(fallback);
  }
  // `fetch` rejects with a TypeError ("Network request failed") when offline.
  if (error instanceof TypeError) return t('common.networkError');
  return t(fallback);
}

function serverMessage(error: ApiError): string | null {
  if (error.status < 400 || error.status >= 500 || error.status === 429) return null;
  const body = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const { message, hint } = body as { message?: unknown; hint?: unknown };
  if (typeof message === 'string' && message.trim()) return message;
  if (typeof hint === 'string' && hint.trim()) return hint;
  return null;
}
