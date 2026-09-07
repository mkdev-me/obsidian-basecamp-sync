import { requestUrl } from 'obsidian';

type NativeResponse = Awaited<ReturnType<typeof requestUrl>>;
// Revalidate every read, preserve pagination headers on 304, and keep private cache data only in memory.
const cache = new Map<string, { body: ArrayBuffer; headers: Record<string, string> }>();
let cacheBytes = 0;
export function clearHttpCache(): void { cache.clear(); cacheBytes = 0; }

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url });
  const clone = response.clone.bind(response);
  response.clone = () => withUrl(clone(), url);
  return response;
}

/** The SDK's fetch calls are bound here at build time, without changing global fetch. */
export const obsidianFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (request.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const headers = Object.fromEntries(request.headers.entries());
  const cacheKey = `${headers.authorization || ''}\n${request.url}`;
  const entry = request.method === 'GET' ? cache.get(cacheKey) : undefined;
  if (entry?.headers.etag) headers['if-none-match'] = entry.headers.etag;
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined : await request.arrayBuffer();
  if (request.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const response = await new Promise<NativeResponse>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request cancelled', 'AbortError'));
    request.signal.addEventListener('abort', abort, { once: true });
    void requestUrl({ url: request.url, method: request.method, headers, body, throw: false })
      .then(resolve, reject).finally(() => request.signal.removeEventListener('abort', abort));
  });
  const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (response.status === 304 && entry) return withUrl(new Response(entry.body, {
    status: 200, headers: { ...entry.headers, ...responseHeaders },
  }), request.url);
  if (request.method === 'GET' && response.status === 200 && responseHeaders.etag && response.arrayBuffer.byteLength <= 1024 * 1024) {
    cacheBytes -= cache.get(cacheKey)?.body.byteLength || 0;
    cache.delete(cacheKey);
    while (cache.size >= 64 || cacheBytes + response.arrayBuffer.byteLength > 8 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cacheBytes -= cache.get(oldest)!.body.byteLength;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { body: response.arrayBuffer, headers: responseHeaders });
    cacheBytes += response.arrayBuffer.byteLength;
  }
  // Fetch forbids bodies on these responses; preserving headers also preserves SDK ETag/pagination.
  const empty = request.method === 'HEAD' || [204, 205, 304].includes(response.status);
  return withUrl(new Response(empty ? null : response.arrayBuffer, {
    status: response.status, headers: response.headers,
  }), request.url);
};
