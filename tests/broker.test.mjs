import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createBroker } from '../broker/server.mjs';

const running = [];
afterEach(async () => { for (const server of running.splice(0)) await new Promise(resolve => server.close(resolve)); });
async function setup() {
  const token = { accessToken: 'fake-access', refreshToken: 'fake-refresh', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 60_000) };
  const exchange = vi.fn(async () => token);
  const refresh = vi.fn(async () => token);
  const server = createBroker({ clientId: 'test-app', clientSecret: 'test-secret', publicUrl: 'https://login.example.com', exchange, refresh });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  running.push(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { origin, post, token, exchange, refresh };
}

describe('shared OAuth service', () => {
  it('keeps secrets server-side, binds the ticket to a verifier, and rejects replay', async () => {
    const { origin, post, token, exchange } = await setup();
    const verifier = 'v'.repeat(43);
    const state = 's'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const start = await post('/start', { state, challenge });
    const authorization = new URL((await start.json()).authorizationUrl);
    expect(authorization.origin).toBe('https://launchpad.37signals.com');
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://login.example.com/callback');
    expect(authorization.href).not.toContain('test-secret');
    const oauthState = authorization.searchParams.get('state');
    expect(oauthState).not.toBe(state);
    const callback = await fetch(`${origin}/callback?code=test-code&state=${oauthState}`, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    const redirect = new URL(callback.headers.get('location'));
    expect(redirect.protocol).toBe('obsidian:');
    expect(redirect.searchParams.get('state')).toBe(state);
    expect(redirect.href).not.toMatch(/fake-access|fake-refresh|test-secret|test-code/);
    const ticket = redirect.searchParams.get('ticket');
    expect((await post('/exchange', { ticket, verifier: 'x'.repeat(43) })).status).toBe(400);
    const result = await post('/exchange', { ticket, verifier });
    expect(await result.json()).toEqual({ ...token, expiresAt: token.expiresAt.toISOString() });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect((await post('/exchange', { ticket, verifier })).status).toBe(400);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown callback states without exchanging a code', async () => {
    const { origin, exchange } = await setup();
    expect((await fetch(`${origin}/callback?code=fake&state=invalid`)).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });
  it('does not accept arbitrary redirect targets', async () => {
    const { post } = await setup();
    const response = await post('/start', { state: 's'.repeat(43), challenge: 'c'.repeat(43), redirectUri: 'https://attacker.example' });
    expect((await response.json()).authorizationUrl).not.toContain('attacker');
  });
  it('refreshes with the server-owned client secret', async () => {
    const { post, refresh } = await setup();
    expect((await post('/refresh', { refreshToken: 'fake-refresh' })).status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'test-app', clientSecret: 'test-secret', refreshToken: 'fake-refresh' }));
  });
  it('never echoes upstream error details', async () => {
    const { post, refresh } = await setup();
    refresh.mockRejectedValue(new Error('secret-token-upstream'));
    const response = await post('/refresh', { refreshToken: 'fake-refresh' });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('secret-token-upstream');
  });
  it('requires HTTPS and configured server credentials', () => {
    expect(() => createBroker({ clientId: 'id', clientSecret: '', publicUrl: 'https://example.com' })).toThrow();
    expect(() => createBroker({ clientId: 'id', clientSecret: 'secret', publicUrl: 'http://example.com' })).toThrow();
  });
});
