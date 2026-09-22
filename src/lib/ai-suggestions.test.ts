import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { suggestionQueryOptions } from '@/lib/ai-suggestions';
import { ApiError } from '@/lib/api/client';
import type { SyncRequest } from '@/lib/sync/auth-bridge';

it('only requests suggestions on demand, including after accepting an ingredient', async () => {
  const client = new QueryClient();
  const request = jest.fn().mockResolvedValue({ ingredients: ['Onion'] });
  const options = (ingredients: string[]) => suggestionQueryOptions(request as SyncRequest,
    ['suggestions', ingredients], JSON.stringify({ name: 'Soup', ingredients, locale: 'en' }), jest.fn());
  const observer = new QueryObserver(client, options([]));
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(request).not.toHaveBeenCalled();
    await observer.refetch();
    expect(observer.getCurrentResult().data?.ingredients).toEqual(['Onion']);
    observer.setOptions(options(['Onion']));
    expect(request).toHaveBeenCalledTimes(1);
    await observer.refetch();
    expect(request).toHaveBeenCalledTimes(2);
  } finally { unsubscribe(); client.clear(); }
});

it('allows an explicit retry after a busy response and refreshes usage on both outcomes', async () => {
  const client = new QueryClient();
  const settled = jest.fn();
  const request = jest.fn().mockRejectedValueOnce(new ApiError(429, 'busy', undefined, { code: 'busy' }))
    .mockResolvedValueOnce({ ingredients: ['Onion'] });
  const observer = new QueryObserver(client, suggestionQueryOptions(request as SyncRequest, ['suggestions'], '{}', settled));
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    expect(observer.getCurrentResult().isError).toBe(true);
    await observer.refetch();
    expect(observer.getCurrentResult().data?.ingredients).toEqual(['Onion']);
    expect(settled).toHaveBeenCalledTimes(2);
  } finally { unsubscribe(); client.clear(); }
});

it('rejects malformed server suggestions without rendering unsafe values', async () => {
  const client = new QueryClient();
  try {
    await expect(client.fetchQuery(suggestionQueryOptions(jest.fn().mockResolvedValue({ ingredients: [null] }) as SyncRequest,
      ['suggestions'], '{}', jest.fn()))).rejects.toThrow('Invalid suggestions response');
  } finally { client.clear(); }
});
