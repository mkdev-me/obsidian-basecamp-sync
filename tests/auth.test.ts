import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { Auth, brokerOrigin } from '../src/auth';
import { DEFAULT_SETTINGS, type Settings } from '../src/model';
import { requestUrl } from './obsidian';

function setup(mode: Settings['authMode'] = 'own') {
  const secrets = new Map<string, string>([['my-client', 'fake-client-secret']]);
  const app = { secretStorage: { getSecret: (key: string) => secrets.get(key) || null,
    setSecret: (key: string, value: string) => { secrets.set(key, value); } } } as unknown as App;
  const settings = { ...DEFAULT_SETTINGS, authMode: mode, clientId: 'my-client', clientSecretName: 'my-client', brokerUrl: 'https://login.example.com' };
  return { auth: new Auth(app, () => settings), secrets, settings };
}
function response(value: unknown, status = 200) {
  const text = JSON.stringify(value);
  return { status, text, headers: { 'Content-Type': 'application/json' }, arrayBuffer: new TextEncoder().encode(text).buffer };
}

describe('device-local authentication', () => {
  beforeEach(() => {
    requestUrl.mockReset();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  });
  it('requires an HTTPS broker without embedded credentials', () => {
    expect(() => brokerOrigin('')).toThrow('not configured');
    expect(() => brokerOrigin('http://example.com')).toThrow();
    expect(() => brokerOrigin('https://user:password@example.com')).toThrow();
    expect(brokerOrigin('https://example.com/')).toBe('https://example.com');
  });
  it('binds an own-app callback to a saved state and stores tokens only in Secret storage', async () => {
    const { auth, secrets } = setup();
    const url = new URL(await auth.start());
    expect(url.searchParams.get('client_id')).toBe('my-client');
    expect(url.href).not.toContain('fake-client-secret');
    await expect(auth.callback({ code: 'fake', state: 'incorrect' })).rejects.toThrow('another device');
    expect(requestUrl).not.toHaveBeenCalled();
    requestUrl.mockResolvedValue(response({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, token_type: 'Bearer' }));
    const state = url.searchParams.get('state')!;
    await auth.callback({ code: 'fake', state });
    expect(await auth.accessToken()).toBe('fake-access');
    expect(secrets.get('basecamp-sync-session')).toContain('fake-refresh');
    expect(secrets.get('basecamp-sync-pending-login')).toBe('');
    await expect(auth.callback({ code: 'fake', state })).rejects.toThrow();
  });
  it('restores a pending login after the app is suspended or restarted', async () => {
    const { auth, secrets } = setup();
    const url = new URL(await auth.start());
    const restarted = setup();
    for (const [key, value] of secrets) restarted.secrets.set(key, value);
    requestUrl.mockResolvedValue(response({ access_token: 'fake-access', expires_in: 3600, token_type: 'Bearer' }));
    await restarted.auth.callback({ code: 'fake', state: url.searchParams.get('state')! });
    expect(restarted.auth.connected()).toBe(true);
  });
  it.each(['own', 'shared'] as const)('exchanges concurrent %s callbacks only once', async mode => {
    const { auth } = setup(mode);
    requestUrl.mockResolvedValue(response({ authorizationUrl: 'https://launchpad.37signals.com/authorization/new' }));
    const url = new URL(await auth.start());
    const sent = requestUrl.mock.calls[0]?.[0];
    const state = mode === 'shared'
      ? JSON.parse(new TextDecoder().decode(sent!.body)).state
      : url.searchParams.get('state');
    requestUrl.mockClear();
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    requestUrl.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const params = { state, code: 'code', ticket: 'encrypted-ticket' };
    const attempts = [auth.callback(params), auth.callback(params), auth.callback(params)];
    await ready;
    expect(requestUrl).toHaveBeenCalledTimes(1);
    finish(response(mode === 'shared'
      ? { accessToken: 'fresh', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600_000).toISOString() }
      : { access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 }));
    await Promise.all(attempts);
    expect(await auth.accessToken()).toBe('fresh');
  });
  it('refreshes concurrently only once and preserves a refresh token omitted by the server', async () => {
    const { auth, secrets } = setup();
    secrets.set('basecamp-sync-session', JSON.stringify({ mode: 'own', clientId: 'my-client', clientSecretName: 'my-client',
      token: { accessToken: 'old', refreshToken: 'retained', expiresAt: new Date(0) } }));
    requestUrl.mockResolvedValue(response({ access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' }));
    expect(await Promise.all([auth.accessToken(), auth.accessToken()])).toEqual(['fresh', 'fresh']);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    expect(secrets.get('basecamp-sync-session')).toContain('retained');
  });
  it('refreshes through the original trusted broker even if settings have changed', async () => {
    const { auth, secrets, settings } = setup('shared');
    secrets.set('basecamp-sync-session', JSON.stringify({ mode: 'shared', broker: 'https://original.example.com',
      token: { accessToken: 'old', refreshToken: 'retained', expiresAt: new Date(0) } }));
    settings.brokerUrl = 'https://different.example.com';
    requestUrl.mockResolvedValue(response({ accessToken: 'fresh', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600_000) }));
    await auth.accessToken();
    expect(requestUrl.mock.calls[0]![0].url).toBe('https://original.example.com/refresh');
  });
  it('keeps shared-app client credentials out of the browser flow', async () => {
    const { auth } = setup('shared');
    requestUrl.mockResolvedValue(response({ authorizationUrl: 'https://launchpad.37signals.com/authorization/new?client_id=shared' }));
    await auth.start();
    const request = requestUrl.mock.calls[0]![0];
    const payload = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, string>;
    expect(Object.keys(payload).sort()).toEqual(['challenge', 'state']);
    expect(payload.challenge).toHaveLength(43);
  });
  it('does not restore a session if disconnect happens during refresh', async () => {
    const { auth, secrets } = setup();
    secrets.set('basecamp-sync-session', JSON.stringify({ mode: 'own', clientId: 'my-client', clientSecretName: 'my-client',
      token: { accessToken: 'old', refreshToken: 'retained', expiresAt: new Date(0) } }));
    let finish!: (value: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    requestUrl.mockImplementation(() => {
      started();
      return new Promise(resolve => { finish = resolve; });
    });
    const request = auth.accessToken();
    await ready;
    auth.disconnect();
    finish(response({ access_token: 'fresh', expires_in: 3600, token_type: 'Bearer' }));
    await expect(request).rejects.toThrow('Disconnected');
    expect(secrets.get('basecamp-sync-session')).toBe('');
  });
});
