import { createBasecampClient } from '@37signals/basecamp';
import { positiveId } from './model';

export interface RemoteDocument {
  id: number;
  title: string;
  content?: string;
  app_url?: string;
  status?: string;
  bucket?: { id: number };
}
export interface RemoteFolder { id: number; title: string }
export interface Gateway {
  validateDestination(project: number, vault: number): Promise<void>;
  getDocument(id: number): Promise<RemoteDocument>;
  listDocuments(vault: number): Promise<RemoteDocument[]>;
  createDocument(vault: number, title: string, html: string): Promise<RemoteDocument>;
  updateDocument(id: number, title: string, html: string): Promise<RemoteDocument>;
  listFolders(vault: number): Promise<RemoteFolder[]>;
  createFolder(vault: number, title: string): Promise<RemoteFolder>;
  upload(data: ArrayBuffer, mime: string, name: string): Promise<string>;
}

export function sdkClient(account: string, accessToken: () => Promise<string>, writes = false) {
  return createBasecampClient({
    accountId: String(positiveId(account)), accessToken,
    userAgent: 'Basecamp Sync/0.1.0 (https://mkdev.me)',
    // The native adapter owns ETag caching so it can preserve Response.url and pagination on 304.
    enableCache: false, enableRetry: !writes,
  });
}

export function gateway(account: string, accessToken: () => Promise<string>): Gateway {
  const read = sdkClient(account, accessToken);
  // Never automatically retry a POST after an uncertain network result.
  const write = sdkClient(account, accessToken, true);
  return {
    validateDestination: async (projectId, vaultId) => {
      const [project, vault] = await Promise.all([read.projects.get(projectId), read.vaults.get(vaultId)]);
      if (project.status !== 'active' || vault.bucket?.id !== project.id)
        throw new Error('Choose an active project and a destination inside that project.');
    },
    getDocument: id => read.documents.get(id),
    listDocuments: async vault => Array.from(await read.documents.list(vault)),
    createDocument: (vault, title, content) => write.documents.create(vault, {
      title, content, status: 'active', subscriptions: [], visibleToClients: false,
    }),
    updateDocument: (id, title, content) => write.documents.replace(id, { title, content }),
    listFolders: async vault => Array.from(await read.vaults.list(vault)),
    createFolder: (vault, title) => write.vaults.create(vault, { title }),
    upload: async (data, mime, name) => {
      const attachment = await write.attachments.create(data, mime, name);
      if (!attachment.attachable_sgid) throw new Error('Basecamp did not return an attachment reference.');
      return attachment.attachable_sgid;
    },
  };
}
