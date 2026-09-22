import { apiRequest } from '@/lib/api/client';

afterEach(() => { jest.restoreAllMocks(); });

it('preserves the server retry deadline and error code', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'busy', message: 'Busy' }), {
    status: 429, headers: { 'Retry-After': '5' },
  }));
  await expect(apiRequest('/ai/suggest')).rejects.toMatchObject({ status: 429, retryAfterMs: 5000, body: { code: 'busy' } });
});

it('ignores malformed retry headers instead of producing invalid timers', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503, headers: { 'Retry-After': 'invalid' } }));
  await expect(apiRequest('/ai/suggest')).rejects.toMatchObject({ status: 503, retryAfterMs: undefined });
});
