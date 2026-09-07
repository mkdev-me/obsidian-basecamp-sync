import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from './obsidian';
import { clearHttpCache, obsidianFetch } from '../src/transport';

function respond(status = 200, text = '{}', headers: Record<string, string> = {}) {
  requestUrl.mockResolvedValue({ status, text, headers, arrayBuffer: new TextEncoder().encode(text).buffer });
}

describe('Obsidian fetch adapter', () => {
  beforeEach(() => { requestUrl.mockReset(); clearHttpCache(); });
  it('preserves request methods, bearer headers and UTF-8 JSON bytes', async () => {
    respond();
    const body = JSON.stringify({ title: 'Grüße 日本語' });
    const response = await obsidianFetch('https://3.basecampapi.com/1/documents/2.json', {
      method: 'PUT', headers: { Authorization: 'Bearer fake-test-token', 'Content-Type': 'application/json' }, body,
    });
    const request = requestUrl.mock.calls[0]![0] as { body: ArrayBuffer; headers: Record<string, string>; method: string; throw: boolean };
    expect(request.method).toBe('PUT');
    expect(request.headers.authorization).toBe('Bearer fake-test-token');
    expect(new TextDecoder().decode(request.body)).toBe(body);
    expect(request.throw).toBe(false);
    expect(await response.json()).toEqual({});
  });
  it('preserves binary uploads exactly', async () => {
    respond(201);
    const bytes = new Uint8Array([0, 1, 128, 255]);
    await obsidianFetch('https://3.basecampapi.com/1/attachments.json', { method: 'POST', body: bytes });
    expect(new Uint8Array(requestUrl.mock.calls[0]![0].body)).toEqual(bytes);
  });
  it('handles empty 304 responses and pagination/rate-limit headers', async () => {
    respond(304, '', { ETag: 'version', Link: '<https://3.basecampapi.com/1/projects.json?page=2>; rel="next"' });
    const response = await obsidianFetch('https://3.basecampapi.com/1/projects.json');
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe('version');
    expect(response.headers.get('link')).toContain('page=2');
    respond(429, '{}', { 'Retry-After': '20' });
    expect((await obsidianFetch('https://3.basecampapi.com/1/projects.json')).headers.get('retry-after')).toBe('20');
  });
  it('does not start an already-cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(obsidianFetch('https://example.com', { signal: controller.signal })).rejects.toThrow();
    expect(requestUrl).not.toHaveBeenCalled();
  });
  it('returns promptly on cancellation even though native HTTP cannot be stopped', async () => {
    requestUrl.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = obsidianFetch('https://example.com', { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toThrow('cancelled');
  });
});
