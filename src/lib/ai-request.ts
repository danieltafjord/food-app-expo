import { ApiError, type RequestOptions } from '@/lib/api/client';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

/** Also settles when a transport ignores cancellation, so a worker cannot hang. */
export async function requestAi<T>(request: SyncRequest, path: string, options: RequestOptions): Promise<T> {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  const cancelled = new Promise<never>((_, reject) => {
    abort.signal.addEventListener('abort', () => {
      const error = new Error('AI request cancelled');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError(408, 'AI request timed out'));
      abort.abort();
    }, 25_000);
  });
  try {
    if (abort.signal.aborted) return await cancelled;
    return await Promise.race([request<T>(path, { ...options, signal: abort.signal }), cancelled, deadline]);
  } finally {
    clearTimeout(timer!);
    options.signal?.removeEventListener('abort', cancel);
  }
}
