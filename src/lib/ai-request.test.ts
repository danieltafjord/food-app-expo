import { requestAi } from '@/lib/ai-request';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

it('times out and aborts a transport that never settles', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const request: SyncRequest = (_path, options) => { signal = options?.signal; return new Promise(() => {}); };
    const pending = requestAi(request, '/ai/categorize', {});
    const assertion = expect(pending).rejects.toMatchObject({ status: 408 });
    await jest.advanceTimersByTimeAsync(25_000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

it('cancels immediately when an opt-out aborts an unresponsive request', async () => {
  const abort = new AbortController();
  const pending = requestAi((() => new Promise(() => {})) as SyncRequest, '/ai/suggest', { signal: abort.signal });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});

it('does not send a request cancelled before it starts', async () => {
  const abort = new AbortController();
  abort.abort();
  const request = jest.fn();
  await expect(requestAi(request, '/ai/suggest', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).not.toHaveBeenCalled();
});
