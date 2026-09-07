import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildAuthorizationUrl, exchangeCode, refreshToken } from '@37signals/basecamp/oauth';

const tokenEndpoint = 'https://launchpad.37signals.com/authorization/token';
const random = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest();
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);

/** A single-process OAuth bridge. No notes pass through it and no tokens are logged. */
export function createBroker({ clientId, clientSecret, publicUrl, exchange = exchangeCode, refresh = refreshToken }) {
  const url = new URL(publicUrl);
  if (!clientId || !clientSecret || url.protocol !== 'https:' || url.username || url.password ||
    url.search || url.hash || url.pathname !== '/') throw new Error('Configure client credentials and a bare HTTPS public origin.');
  const redirectUri = `${url.origin}/callback`;
  const pending = new Map();
  const tickets = new Map();
  const rate = new Map();
  function prune(map) { for (const [id, value] of map) if (value.expires <= Date.now()) map.delete(id); }

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    function json(status, value) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    }
    function redirect(location) { res.writeHead(302, { Location: location }); res.end(); }
    async function body() {
      if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required');
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 16_384) throw new Error('Body too large');
      }
      return JSON.parse(text);
    }
    try {
      prune(pending); prune(tickets); prune(rate);
      // An additional per-IP limit belongs at the HTTPS reverse proxy. Ignore spoofable forwarding headers here.
      const ip = req.socket.remoteAddress || 'unknown';
      const quota = rate.get(ip) || { count: 0, expires: Date.now() + 60_000 };
      if (quota.count++ >= 120 || rate.size >= 10_000) return json(429, { error: 'Try again later.' });
      rate.set(ip, quota);
      const path = new URL(req.url, url.origin);
      if (req.method === 'GET' && path.pathname === '/health') return json(200, { ok: true });
      if (req.method === 'POST' && path.pathname === '/start') {
        const { state, challenge } = await body();
        if (!key(state) || !key(challenge)) return json(400, { error: 'Invalid login request.' });
        if (pending.size + tickets.size >= 1000) return json(503, { error: 'Try again later.' });
        const oauthState = random();
        pending.set(oauthState, { state, challenge, expires: Date.now() + 10 * 60_000 });
        const authorizationUrl = buildAuthorizationUrl({
          authorizationEndpoint: 'https://launchpad.37signals.com/authorization/new',
          clientId, redirectUri, state: oauthState,
        }).href;
        return json(200, { authorizationUrl });
      }
      if (req.method === 'GET' && path.pathname === '/callback') {
        const oauthState = path.searchParams.get('state');
        const login = pending.get(oauthState);
        if (!login) return json(400, { error: 'Login expired. Start again in Obsidian.' });
        pending.delete(oauthState);
        if (path.searchParams.has('error')) return redirect(`obsidian://basecamp-sync?${new URLSearchParams({
          state: login.state, error: 'access_denied',
        })}`);
        const code = path.searchParams.get('code');
        if (!code || code.length > 8192) return json(400, { error: 'Missing authorization code.' });
        const token = await exchange({ tokenEndpoint, clientId, clientSecret, redirectUri, code, useLegacyFormat: true });
        const ticket = random();
        tickets.set(ticket, { ...login, token, expires: Date.now() + 5 * 60_000 });
        // Only an opaque, short-lived, verifier-bound ticket enters the deep link. Never access/refresh tokens.
        return redirect(`obsidian://basecamp-sync?${new URLSearchParams({ ticket, state: login.state })}`);
      }
      if (req.method === 'POST' && path.pathname === '/exchange') {
        const { ticket, verifier } = await body();
        const login = tickets.get(ticket);
        if (!login || !key(verifier)) return json(400, { error: 'Invalid or expired login.' });
        const challenge = digest(verifier).toString('base64url');
        if (!timingSafeEqual(digest(challenge), digest(login.challenge)))
          return json(400, { error: 'Invalid or expired login.' });
        tickets.delete(ticket);
        return json(200, login.token);
      }
      if (req.method === 'POST' && path.pathname === '/refresh') {
        const { refreshToken: old } = await body();
        if (typeof old !== 'string' || !old || old.length > 12_000) return json(400, { error: 'Invalid refresh request.' });
        const token = await refresh({ tokenEndpoint, clientId, clientSecret, refreshToken: old, useLegacyFormat: true });
        return json(200, token);
      }
      return json(404, { error: 'Not found.' });
    } catch {
      // SDK errors may contain upstream details. Never echo or log requests, codes, credentials or tokens.
      return json(400, { error: 'Authorization failed. Start again in Obsidian.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createBroker({ clientId: process.env.BASECAMP_CLIENT_ID,
    clientSecret: process.env.BASECAMP_CLIENT_SECRET, publicUrl: process.env.PUBLIC_URL });
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
    console.log('Basecamp Sync login service is listening.');
  });
}
