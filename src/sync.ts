import type { Gateway, RemoteDocument } from './basecamp';
import { type Binding, type Note, type Settings, documentUrl, positiveId, sha256 } from './model';
import type { Rendered } from './render';
import { relativeNotePath, selection } from './selection';

export interface SyncHost {
  read(path: string): Promise<Note>;
  saveBinding(path: string, binding: Binding): Promise<void>;
  render(note: Note, upload: boolean): Promise<Rendered>;
}
export interface SyncResult {
  path: string;
  status: 'created' | 'updated' | 'unchanged' | 'skipped' | 'error';
  detail?: string;
  warnings?: string[];
}

export async function remoteHash(document: RemoteDocument): Promise<string> {
  return sha256(JSON.stringify([document.title, document.content || '']));
}

export class SyncEngine {
  private running = false;
  private cancelled = false;
  private folders = new Map<string, number>();
  private validated = new Set<number>();

  constructor(private readonly host: SyncHost, private readonly api: Gateway,
    private readonly settings: Settings) {}

  cancel(): void { this.cancelled = true; }
  isCancelled(): boolean { return this.cancelled; }

  async run(paths: string[], allNotes: Note[], onResult?: (result: SyncResult) => void): Promise<SyncResult[]> {
    if (this.running) throw new Error('A sync is already running.');
    positiveId(this.settings.accountId);
    positiveId(this.settings.projectId);
    positiveId(this.settings.vaultId);
    const selected = selection(this.settings.includes, this.settings.excludes, this.settings.sourceFolder);
    const identities = new Map<string, number>();
    for (const note of allNotes) {
      if (!note.binding) continue;
      const keys = [`note:${note.binding.id}`];
      if (note.binding.document) keys.push(`document:${note.binding.account}:${note.binding.document}`);
      for (const key of keys) identities.set(key, (identities.get(key) || 0) + 1);
    }
    this.running = true;
    const results: SyncResult[] = [];
    try {
      for (const path of [...new Set(paths)].sort()) {
        if (this.cancelled) break;
        let result: SyncResult;
        try {
          const note = await this.host.read(path);
          if (!selected(path) || note.disabled) result = { path, status: 'skipped' };
          else {
            const binding = note.binding;
            if (binding && ((identities.get(`note:${binding.id}`) || 0) > 1 ||
              (binding.document && (identities.get(`document:${binding.account}:${binding.document}`) || 0) > 1)))
              throw new Error('Two notes share the same sync identity. Remove basecamp_sync properties from the copy.');
            result = await this.sync(note);
          }
        } catch (error) {
          result = { path, status: 'error', detail: error instanceof Error ? error.message : 'Sync failed.' };
          if (error && typeof error === 'object' && 'code' in error &&
            ['auth_required', 'network', 'rate_limit'].includes(String(error.code))) {
            this.cancelled = true;
            result.detail += ' Sync paused; remaining notes were not sent. Retry when the connection is ready.';
          }
        }
        results.push(result);
        onResult?.(result);
      }
      return results;
    } finally { this.running = false; }
  }

  private validateDocument(document: RemoteDocument): void {
    if (document.bucket?.id !== positiveId(this.settings.projectId))
      throw new Error('This document is in a different Basecamp project. Choose its original destination.');
    if (document.status && document.status !== 'active')
      throw new Error('This Basecamp document is archived, trashed or a draft. Restore it before syncing.');
  }

  private async destination(path: string): Promise<number> {
    let parent = positiveId(this.settings.vaultId);
    if (!this.settings.mirrorFolders) return parent;
    const relative = relativeNotePath(path, this.settings.sourceFolder);
    if (!relative) throw new Error('This note is outside the source folder.');
    const parts = relative.split('/').slice(0, -1);
    for (const title of parts) {
      const key = `${parent}:${title}`;
      let id = this.folders.get(key);
      if (!id) {
        const matches = (await this.api.listFolders(parent)).filter(folder => folder.title === title);
        if (matches.length > 1) throw new Error(`More than one Basecamp folder is named “${title}”. Rename the duplicate first.`);
        id = matches[0]?.id || (await this.api.createFolder(parent, title)).id;
        this.folders.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  private async sync(note: Note): Promise<SyncResult> {
    let binding = note.binding;
    if (binding && (binding.account !== this.settings.accountId ||
      binding.project !== positiveId(this.settings.projectId) || binding.root !== positiveId(this.settings.vaultId)))
      throw new Error('This note is linked to a different destination. Restore that destination or explicitly unlink the note.');

    // An interrupted create has a durable marker. Only adopt an exact remote match; never create twice.
    if (binding?.pending && !binding.document) {
      const matches = (await this.api.listDocuments(binding.vault))
        .filter(document => document.content?.includes(`basecamp-sync-id=${binding!.id}`));
      if (matches.length !== 1)
        throw new Error('An earlier create has an unknown outcome. Inspect Basecamp and use “Link current note to existing document” before retrying.');
      const remote = matches[0]!;
      this.validateDocument(remote);
      binding = { ...binding, document: remote.id, url: documentUrl(binding.account, binding.project, remote.id),
        remoteHash: await remoteHash(remote), pending: false };
      await this.host.saveBinding(note.path, binding);
      note.binding = binding;
    }

    const draft = await this.host.render(note, false);
    const sourceHash = await sha256(JSON.stringify([note.title, note.path, draft.hash]));
    if (binding?.document && !binding.pending && binding.sourceHash === sourceHash)
      return { path: note.path, status: 'unchanged', warnings: draft.warnings };

    let current: RemoteDocument | undefined;
    if (binding?.document) {
      current = await this.api.getDocument(binding.document);
      this.validateDocument(current);
      if (!binding.remoteHash || await remoteHash(current) !== binding.remoteHash)
        throw new Error('The Basecamp document changed since the last sync. Review it, then link this note again to accept its current version.');
    }
    if (this.cancelled) return { path: note.path, status: 'skipped' };

    if (!binding?.document) {
      const parent = binding?.vault || positiveId(this.settings.vaultId);
      if (!this.validated.has(parent)) {
        await this.api.validateDestination(positiveId(this.settings.projectId), parent);
        this.validated.add(parent);
      }
    }

    if (!binding) {
      binding = { id: crypto.randomUUID(), account: this.settings.accountId,
        project: positiveId(this.settings.projectId), root: positiveId(this.settings.vaultId),
        vault: await this.destination(note.path), pending: false };
      // The stable identity also scopes attachment reuse to this one document.
      await this.host.saveBinding(note.path, binding);
      note.binding = binding;
    }
    const rendered = await this.host.render(note, true);
    if (this.cancelled) return { path: note.path, status: 'skipped' };
    if (!current) {
      binding = { ...binding, pending: true };
      // Checkpoint immediately before the POST, not before potentially failing attachment uploads.
      await this.host.saveBinding(note.path, binding);
    }
    let remote: RemoteDocument;
    if (current) {
      // Attachment uploads may take time. Check again immediately before replacing the document.
      const latest = await this.api.getDocument(current.id);
      this.validateDocument(latest);
      if (await remoteHash(latest) !== binding.remoteHash)
        throw new Error('The Basecamp document changed while preparing this update. Review it before syncing again.');
      remote = await this.api.updateDocument(current.id, note.title, rendered.html);
    } else {
      try { remote = await this.api.createDocument(binding.vault, note.title, rendered.html); }
      catch (error) {
        const status = error && typeof error === 'object' && 'httpStatus' in error ? error.httpStatus : undefined;
        if (typeof status === 'number' && [400, 401, 403, 404, 422, 429].includes(status))
          await this.host.saveBinding(note.path, { ...binding, pending: false });
        throw error;
      }
    }
    // Use Basecamp's canonical representation, including its attachment normalization.
    binding = { ...binding, document: remote.id,
      url: documentUrl(binding.account, binding.project, remote.id),
      sourceHash, remoteHash: await remoteHash(remote), pending: false };
    await this.host.saveBinding(note.path, binding);
    return { path: note.path, status: current ? 'updated' : 'created', warnings: rendered.warnings };
  }
}
