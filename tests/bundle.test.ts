import { beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';

beforeAll(() => { execFileSync(process.execPath, ['esbuild.config.mjs']); });

function load(requestUrl: ReturnType<typeof vi.fn>) {
  const hostFetch = vi.fn(() => { throw new Error('Global fetch must not be used'); });
  const module = { exports: {} as { default: new () => { auth: object; client: (account: string) => any } } };
  class SafariRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.body instanceof ReadableStream) throw new Error('Safari cannot construct an upload stream');
      super(input, init);
    }
  }
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const context = createContext({
    module, exports: module.exports, require: (name: string) => {
      if (name !== 'obsidian') throw new Error(`Unexpected runtime import ${name}`);
      return { Plugin: class {}, PluginSettingTab: class {}, requestUrl };
    },
    URL, URLSearchParams, Request: SafariRequest, Response, Headers, AbortController, AbortSignal: {}, DOMException, TextEncoder, TextDecoder, FormData,
    Uint8Array, ArrayBuffer, crypto, performance, setTimeout, clearTimeout, btoa, atob,
    fetch: hostFetch,
    window: { setTimeout: (callback: () => void, milliseconds: number) => {
      const timer = setTimeout(callback, milliseconds); timer.unref(); timers.add(timer); return timer;
    }, clearTimeout },
  });
  new Script(readFileSync('main.js', 'utf8')).runInContext(context);
  const plugin = new module.exports.default();
  plugin.auth = { accessToken: async () => 'fake-bundle-token' };
  return { client: plugin.client('123'), context, hostFetch };
}

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  const text = JSON.stringify(value);
  return { status, headers, text, arrayBuffer: new TextEncoder().encode(text).buffer };
}

describe('shipped browser bundle and real SDK', () => {
  it('loads without Node, routes SDK pagination through native HTTP, and preserves cached next-page links', async () => {
    const native = vi.fn()
      .mockResolvedValueOnce(response([{ id: 1, name: 'First' }], 200, { ETag: 'first', Link: '</123/projects.json?page=2>; rel="next"' }))
      .mockResolvedValueOnce(response([{ id: 2, name: 'Second' }], 200, { ETag: 'second' }))
      .mockResolvedValueOnce(response(null, 304))
      .mockResolvedValueOnce(response(null, 304));
    const { client, hostFetch, context } = load(native);
    expect(context.Buffer).toBeUndefined();
    expect(context.process).toBeUndefined();
    expect((await client.projects.list()).map((project: { id: number }) => project.id)).toEqual([1, 2]);
    expect((await client.projects.list()).map((project: { id: number }) => project.id)).toEqual([1, 2]);
    expect(native).toHaveBeenCalledTimes(4);
    expect(native.mock.calls[1]![0].url).toBe('https://3.basecampapi.com/123/projects.json?page=2');
    expect(native.mock.calls[2]![0].headers['if-none-match']).toBe('first');
    expect(native.mock.calls[0]![0].headers.authorization).toBe('Bearer fake-bundle-token');
    expect(hostFetch).not.toHaveBeenCalled();
  });
  it('refuses a pagination URL on another origin', async () => {
    const native = vi.fn().mockResolvedValue(response([], 200, { Link: '<https://attacker.example/data>; rel="next"' }));
    const { client } = load(native);
    await expect(client.projects.list()).rejects.toThrow('different origin');
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('sends complete rich documents and binary attachments via the official SDK', async () => {
    const native = vi.fn().mockResolvedValue(response({ id: 3, title: 'Title', content: '<div>Body</div>' }));
    const { client } = load(native);
    await client.documents.replace(3, { title: 'Title', content: '<div>Body</div>' });
    const request = native.mock.calls[0]![0];
    expect(request.method).toBe('PUT');
    expect(request.url).toBe('https://3.basecampapi.com/123/documents/3');
    expect(request.headers.accept).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({ title: 'Title', content: '<div>Body</div>' });
    native.mockResolvedValue(response({ attachable_sgid: 'fake-sgid' }, 201));
    const bytes = new Uint8Array([0, 10, 128, 255]);
    await client.attachments.create(bytes, 'image/png', 'a.png');
    expect(new Uint8Array(native.mock.calls[1]![0].body)).toEqual(bytes);
  });
});
