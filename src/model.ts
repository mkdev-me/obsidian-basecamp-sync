export interface Binding {
  id: string;
  account: string;
  project: number;
  root: number;
  vault: number;
  document?: number;
  url?: string;
  sourceHash?: string;
  remoteHash?: string;
  pending?: boolean;
}

export interface Note {
  path: string;
  title: string;
  markdown: string;
  binding?: Binding;
  disabled?: boolean;
}

export interface Settings {
  authMode: 'shared' | 'own' | 'token';
  brokerUrl: string;
  clientId: string;
  clientSecretName: string;
  tokenSecretName: string;
  redirectUri: string;
  accountId: string;
  projectId: string;
  vaultId: string;
  includes: string[];
  excludes: string[];
  mirrorFolders: boolean;
  uploadAttachments: boolean;
  autoSync: boolean;
  debounceSeconds: number;
}

// Set only after mkdev has deployed and verified its shared OAuth service.
export const DEFAULT_BROKER_URL = '';
export const DEFAULT_SETTINGS: Settings = {
  authMode: 'shared', brokerUrl: DEFAULT_BROKER_URL, clientId: '',
  clientSecretName: '', tokenSecretName: '',
  redirectUri: 'obsidian://basecamp-sync',
  accountId: '', projectId: '', vaultId: '', includes: [], excludes: [],
  mirrorFolders: true, uploadAttachments: true, autoSync: false, debounceSeconds: 15,
};

export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, '');
  if (!/^---\r?\n/.test(text)) return text;
  const match = /^---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('Unclosed note properties. Close the YAML block before syncing.');
  return text.slice(match[0].length);
}

export function positiveId(value: string | number): number {
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(number) || number <= 0)
    throw new Error('Choose a valid Basecamp account, project and destination.');
  return number;
}

export function parseBinding(value: unknown): Binding | undefined {
  if (value === undefined || value === false) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Invalid basecamp_sync properties.');
  const binding = value as Binding;
  if (typeof binding.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(binding.id))
    throw new Error('Invalid Basecamp note identity.');
  for (const key of ['account', 'project', 'root', 'vault'] as const) positiveId(binding[key]);
  if (binding.document !== undefined) positiveId(binding.document);
  for (const key of ['sourceHash', 'remoteHash'] as const) {
    if (binding[key] !== undefined && !/^[a-f0-9]{64}$/.test(binding[key]))
      throw new Error('Invalid Basecamp sync fingerprint.');
  }
  return { ...binding, account: String(binding.account) };
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

export function noteUri(vault: string, path: string): string {
  return `obsidian://open?${new URLSearchParams({ vault, file: path })}`;
}

export function documentUrl(account: string, project: number, id: number): string {
  return `https://3.basecamp.com/${positiveId(account)}/buckets/${positiveId(project)}/documents/${positiveId(id)}`;
}
