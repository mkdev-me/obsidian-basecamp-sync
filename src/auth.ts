import type { App } from 'obsidian';
import { buildAuthorizationUrl, exchangeCode, generatePKCE, generateState, refreshToken,
  type OAuthToken } from '@37signals/basecamp/oauth';
import type { Settings } from './model';
import { clearHttpCache, obsidianFetch } from './transport';

const TOKEN_ENDPOINT = 'https://launchpad.37signals.com/authorization/token';
const SESSION_KEY = 'basecamp-sync-session';
const PENDING_KEY = 'basecamp-sync-pending-login';
interface Connection {
  mode: 'own' | 'shared';
  broker: string;
  clientId: string;
  clientSecretName: string;
  redirectUri: string;
}
interface Session extends Connection { token: OAuthToken }
interface Pending extends Connection { state: string; verifier: string; expires: number }

export function brokerOrigin(value: string): string {
  if (!value) throw new Error('The shared integration is not configured yet. Set its HTTPS login-service URL or use your own integration.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('The login service must use an HTTPS URL without credentials, a query or a fragment.');
  return url.href.replace(/\/$/, '');
}

async function brokerRequest<T>(url: string, body: object): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await obsidianFetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw new Error(`Login service returned ${response.status}. Reconnect or check its configuration.`);
    return await response.json() as T;
  } finally { window.clearTimeout(timer); }
}

export class Auth {
  private refreshing?: Promise<string>;
  private completing?: { state: string; promise: Promise<void> };
  private generation = 0;
  constructor(private readonly app: App, private readonly settings: () => Settings) {}

  private get<T>(key: string): T | undefined {
    const value = this.app.secretStorage.getSecret(key);
    return value ? JSON.parse(value) as T : undefined;
  }
  private save(key: string, value: unknown): void {
    this.app.secretStorage.setSecret(key, JSON.stringify(value));
  }
  private secret(name: string): string {
    const secret = name && this.app.secretStorage.getSecret(name);
    if (!secret) throw new Error('Select the required credential in Secret storage first.');
    return secret;
  }
  disconnect(): void {
    this.generation++;
    clearHttpCache();
    this.app.secretStorage.setSecret(SESSION_KEY, '');
    this.app.secretStorage.setSecret(PENDING_KEY, '');
  }
  connected(): boolean {
    const settings = this.settings();
    return settings.authMode === 'token'
      ? Boolean(settings.tokenSecretName && this.app.secretStorage.getSecret(settings.tokenSecretName))
      : Boolean(this.get<Session>(SESSION_KEY));
  }

  async start(): Promise<string> {
    const settings = this.settings();
    if (settings.authMode === 'token') throw new Error('Select a stored access token, then load accounts.');
    const pkce = await generatePKCE();
    const pending: Pending = {
      mode: settings.authMode, broker: settings.authMode === 'shared' ? brokerOrigin(settings.brokerUrl) : '',
      clientId: settings.clientId, clientSecretName: settings.clientSecretName,
      redirectUri: settings.redirectUri, state: generateState(), verifier: pkce.verifier,
      expires: Date.now() + 10 * 60_000,
    };
    this.save(PENDING_KEY, pending);
    if (pending.mode === 'shared') {
      const result = await brokerRequest<{ authorizationUrl: string }>(`${pending.broker}/start`, {
        state: pending.state, challenge: pkce.challenge,
      });
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://launchpad.37signals.com' || url.pathname !== '/authorization/new')
        throw new Error('The login service returned an unexpected authorization URL.');
      return url.href;
    }
    if (!pending.clientId.trim()) throw new Error('Enter your integration client ID first.');
    this.secret(pending.clientSecretName);
    const redirect = new URL(pending.redirectUri);
    if (!(redirect.protocol === 'https:' || pending.redirectUri === 'obsidian://basecamp-sync'))
      throw new Error('Use the Obsidian callback or an HTTPS callback you control.');
    // Launchpad currently does not advertise S256. State still binds this callback to this device.
    return buildAuthorizationUrl({ authorizationEndpoint: 'https://launchpad.37signals.com/authorization/new',
      clientId: pending.clientId, redirectUri: pending.redirectUri, state: pending.state }).href;
  }

  async callback(params: Record<string, string>): Promise<void> {
    const pending = this.get<Pending>(PENDING_KEY);
    if (!pending || pending.expires < Date.now() || params.state !== pending.state)
      throw new Error('This login callback is expired or belongs to another device. Start connecting again.');
    if (params.error) throw new Error('Basecamp authorization was cancelled.');
    if (this.completing?.state === pending.state) return this.completing.promise;
    const promise = this.complete(pending, params);
    this.completing = { state: pending.state, promise };
    try { await promise; }
    finally { if (this.completing?.promise === promise) this.completing = undefined; }
  }

  private async complete(pending: Pending, params: Record<string, string>): Promise<void> {
    const token = pending.mode === 'shared'
      ? await brokerRequest<OAuthToken>(`${pending.broker}/exchange`, { ticket: params.ticket, verifier: pending.verifier })
      : await exchangeCode({ tokenEndpoint: TOKEN_ENDPOINT, clientId: pending.clientId,
        clientSecret: this.secret(pending.clientSecretName), redirectUri: pending.redirectUri,
        code: params.code || '', useLegacyFormat: true }, { fetch: obsidianFetch });
    if (!token.accessToken || token.tokenType?.toLowerCase() !== 'bearer')
      throw new Error('Basecamp did not return a usable bearer token.');
    if (this.get<Pending>(PENDING_KEY)?.state !== pending.state)
      throw new Error('This login was cancelled or replaced by another connection.');
    this.generation++;
    this.save(SESSION_KEY, { mode: pending.mode, broker: pending.broker, clientId: pending.clientId,
      clientSecretName: pending.clientSecretName, redirectUri: pending.redirectUri, token });
    this.app.secretStorage.setSecret(PENDING_KEY, '');
  }

  async accessToken(): Promise<string> {
    if (this.settings().authMode === 'token') return this.secret(this.settings().tokenSecretName);
    const session = this.get<Session>(SESSION_KEY);
    if (!session) throw new Error('Connect to Basecamp in the plugin settings first.');
    if (session.mode !== this.settings().authMode)
      throw new Error('The login method changed. Reconnect to use it.');
    const expires = session.token.expiresAt ? new Date(session.token.expiresAt).getTime() : 0;
    if (expires > Date.now() + 60_000) return session.token.accessToken;
    if (!session.token.refreshToken) throw new Error('The Basecamp token expired. Connect again.');
    if (!this.refreshing) this.refreshing = this.refresh(session).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async refresh(session: Session): Promise<string> {
    const generation = this.generation;
    const fresh = session.mode === 'shared'
      ? await brokerRequest<OAuthToken>(`${brokerOrigin(session.broker)}/refresh`, { refreshToken: session.token.refreshToken })
      : await refreshToken({ tokenEndpoint: TOKEN_ENDPOINT, clientId: session.clientId,
        clientSecret: this.secret(session.clientSecretName), refreshToken: session.token.refreshToken!,
        useLegacyFormat: true }, { fetch: obsidianFetch });
    if (!fresh.accessToken) throw new Error('Could not refresh Basecamp authorization. Connect again.');
    if (generation !== this.generation) throw new Error('Disconnected from Basecamp.');
    session.token = { ...fresh, refreshToken: fresh.refreshToken || session.token.refreshToken };
    this.save(SESSION_KEY, session);
    return fresh.accessToken;
  }
}
