import { getFrontMatterInfo, Modal, Notice, parseYaml, Plugin, sanitizeHTMLToDom, Setting, TFile } from 'obsidian';
import { Auth } from './auth';
import { gateway, sdkClient, type Gateway } from './basecamp';
import { DEFAULT_BROKER_URL, DEFAULT_SETTINGS, type Binding, type Note, type Settings, documentUrl, noteUri,
  parseBinding, positiveId, sha256 } from './model';
import { renderNote, type Rendered } from './render';
import { relativeNotePath, selection } from './selection';
import { BasecampSettingsTab } from './settings';
import { remoteHash, SyncEngine, type SyncResult } from './sync';
import { clearHttpCache } from './transport';

interface Data {
  settings: Settings;
  attachments: Record<string, { hash: string; sgid: string }>;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  mp3: 'audio/mpeg', mp4: 'video/mp4', m4a: 'audio/mp4', wav: 'audio/wav', zip: 'application/zip',
};

export default class BasecampSyncPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  auth!: Auth;
  private data: Data = { settings: this.settings, attachments: {} };
  private api?: Gateway;
  private engine?: SyncEngine;
  private working = false;
  private unloading = false;
  private timer?: number;
  private dirty = new Set<string>();
  private saving: Promise<void> = Promise.resolve();
  private hashes = new Map<string, { mtime: number; size: number; hash: string }>();
  private bindings = new Map<string, Binding | undefined>();
  private activeSettings?: Settings;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<Data> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved?.settings,
      brokerUrl: saved?.settings?.brokerUrl?.trim() || DEFAULT_BROKER_URL,
      autoSync: this.app.loadLocalStorage('basecamp-sync-auto') === true };
    this.data = { settings: this.settings, attachments: saved?.attachments || {} };
    this.auth = new Auth(this.app, () => this.settings);
    this.addSettingTab(new BasecampSettingsTab(this.app, this));
    this.addRibbonIcon('cloud-upload', 'Preview Basecamp sync', () => { void this.showPlan(); });
    this.addCommand({ id: 'sync-selected', name: 'Sync selected notes', callback: () => { void this.sync(); } });
    this.addCommand({ id: 'sync-current', name: 'Sync current note', callback: () => {
      const file = this.app.workspace.getActiveFile();
      if (file) void this.sync([file.path]);
    } });
    this.addCommand({ id: 'preview-sync', name: 'Preview selected notes', callback: () => { void this.showPlan(); } });
    this.addCommand({ id: 'preview-current', name: 'Preview current note formatting', callback: () => { void this.previewCurrent(); } });
    this.addCommand({ id: 'link-current', name: 'Link current note to existing document', callback: () => { this.linkCurrent(); } });
    this.addCommand({ id: 'open-document', name: 'Open current note in Basecamp', callback: () => { void this.openCurrent(); } });
    this.addCommand({ id: 'stop-sync', name: 'Stop after the current request', callback: () => { this.engine?.cancel(); } });
    this.registerObsidianProtocolHandler('basecamp-sync', params => {
      void this.auth.callback(params).then(() => {
        this.api = undefined;
        new Notice('Connected to Basecamp. Load your accounts in the plugin settings.');
      }).catch(error => this.report(error));
    });
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file instanceof TFile && file.extension === 'md') this.queue(file.path);
      else if (file instanceof TFile) {
        this.hashes.delete(file.path);
        // A changed embedded file can affect any selected note. No periodic vault scans.
        for (const note of this.selectedFiles()) this.queue(note.path);
      }
    }));
    this.registerEvent(this.app.vault.on('rename', file => {
      this.bindings.clear();
      if (file instanceof TFile && file.extension === 'md') this.queue(file.path);
    }));
  }

  onunload(): void {
    clearHttpCache();
    this.unloading = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.engine?.cancel();
    this.dirty.clear();
  }

  report(error: unknown): void {
    // Avoid logging SDK exceptions or responses, which may contain credentials or private content.
    new Notice(error instanceof Error ? error.message : 'Basecamp sync failed.', 10_000);
  }

  async saveSettings(): Promise<void> {
    this.settings.brokerUrl = this.settings.brokerUrl.trim() || DEFAULT_BROKER_URL;
    if (!this.settings.autoSync) {
      if (this.timer !== undefined) window.clearTimeout(this.timer);
      this.timer = undefined;
      this.dirty.clear();
    }
    this.app.saveLocalStorage('basecamp-sync-auto', this.settings.autoSync);
    await this.persist();
    this.api = undefined;
  }
  private async persist(): Promise<void> {
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData({
      ...this.data, settings: { ...this.settings, autoSync: false },
    }));
    await this.saving;
  }
  client(account = this.settings.accountId) {
    return sdkClient(account || '1', () => this.auth.accessToken());
  }
  private gateway(): Gateway {
    return this.api ||= gateway((this.activeSettings || this.settings).accountId, () => this.auth.accessToken());
  }
  selectedFiles(): TFile[] {
    const accepts = selection(this.settings.includes, this.settings.excludes, this.settings.sourceFolder);
    return this.app.vault.getMarkdownFiles().filter(file => accepts(file.path) &&
      this.app.metadataCache.getFileCache(file)?.frontmatter?.basecamp_sync !== false);
  }
  private file(path: string): TFile {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`Note “${path}” was moved or deleted. Run sync again.`);
    return file;
  }
  async readNote(path: string): Promise<Note> {
    const file = this.file(path);
    const markdown = await this.app.vault.read(file);
    const info = getFrontMatterInfo(markdown);
    const frontmatter = info.exists ? parseYaml(info.frontmatter) as Record<string, unknown> | null : null;
    const binding = parseBinding(frontmatter?.basecamp_sync);
    this.bindings.set(path, binding);
    const title = typeof frontmatter?.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : file.basename;
    return { path, title, markdown, binding, disabled: frontmatter?.basecamp_sync === false };
  }
  private async saveBinding(path: string, binding: Binding): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(path), frontmatter => {
      const properties = frontmatter as Record<string, unknown>;
      const previous = parseBinding(properties.basecamp_sync);
      if (previous && previous.id !== binding.id) throw new Error('The note identity changed during sync. Try again.');
      if (properties.basecamp_sync === false) throw new Error('This note was excluded during sync.');
      properties.basecamp_sync = { ...binding };
    });
    this.bindings.set(path, binding);
  }

  async render(note: Note, upload: boolean): Promise<Rendered> {
    const settings = this.activeSettings || this.settings;
    return renderNote(note.markdown, { resolve: async (raw, embed) => {
      let target = raw;
      try { target = decodeURIComponent(raw); } catch { /* A literal percent is a valid filename. */ }
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//'))
        return { warning: `Unsupported link: ${raw}` };
      const [linkpath, ...heading] = target.split('#');
      const file = linkpath ? this.app.metadataCache.getFirstLinkpathDest(linkpath, note.path) : this.file(note.path);
      if (!file) return { warning: `Unresolved link: ${raw}` };
      const localUrl = noteUri(this.app.vault.getName(), file.path) + (heading.length ? `&subpath=${encodeURIComponent('#' + heading.join('#'))}` : '');
      if (file.extension === 'md') {
        const binding = this.bindings.has(file.path) ? this.bindings.get(file.path)
          : parseBinding(this.app.metadataCache.getFileCache(file)?.frontmatter?.basecamp_sync);
        const sameDestination = binding?.account === settings.accountId &&
          binding.project === Number(settings.projectId) && binding.root === Number(settings.vaultId);
        const url = sameDestination && binding?.document
          ? documentUrl(binding.account, binding.project, binding.document) : localUrl;
        return { url, fingerprint: url, warning: embed ? 'Embedded notes are linked; their contents are not copied.'
          : heading.length ? 'Heading links point to the document; Basecamp does not preserve Obsidian anchors.' : undefined };
      }
      if (!embed) return { url: localUrl, warning: 'Local file links open in Obsidian. Embed a file to upload it.' };
      if (!settings.uploadAttachments) return { url: localUrl, warning: 'Attachment uploads are disabled.' };
      if (file.stat.size > 20 * 1024 * 1024) throw new Error(`Attachment “${file.name}” exceeds the 20 MB mobile limit.`);
      let cachedHash = this.hashes.get(file.path);
      if (!cachedHash || cachedHash.mtime !== file.stat.mtime || cachedHash.size !== file.stat.size) {
        cachedHash = { mtime: file.stat.mtime, size: file.stat.size, hash: await sha256(await this.app.vault.readBinary(file)) };
        this.hashes.set(file.path, cachedHash);
      }
      if (!upload) return { url: localUrl, fingerprint: cachedHash.hash };
      if (!note.binding) throw new Error('Save the note identity before uploading attachments.');
      const key = `${note.binding.account}:${note.binding.id}:${file.path}`;
      let cached = this.data.attachments[key];
      if (!cached || cached.hash !== cachedHash.hash) {
        const sgid = await this.gateway().upload(await this.app.vault.readBinary(file),
          MIME[file.extension.toLowerCase()] || 'application/octet-stream', file.name);
        cached = { hash: cachedHash.hash, sgid };
        this.data.attachments[key] = cached;
        await this.persist();
      }
      return { sgid: cached.sgid, fingerprint: cached.hash };
    } });
  }

  private queue(path: string): void {
    if (!this.settings.autoSync || this.unloading) return;
    try { if (!selection(this.settings.includes, this.settings.excludes, this.settings.sourceFolder)(path)) return; }
    catch (error) { this.report(error); return; }
    this.dirty.add(path);
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (this.working) { this.queue(path); return; }
      const paths = [...this.dirty];
      this.dirty.clear();
      void this.sync(paths, true);
    }, Math.max(5, this.settings.debounceSeconds) * 1000);
  }

  async sync(paths?: string[], background = false): Promise<void> {
    if (this.working) { if (!background) new Notice('A Basecamp sync is already running.'); return; }
    this.working = true;
    this.activeSettings = { ...this.settings, includes: [...this.settings.includes], excludes: [...this.settings.excludes] };
    this.api = undefined;
    try {
      const targetPaths = paths || this.selectedFiles().map(file => file.path);
      if (!targetPaths.length) { if (!background) new Notice('Choose notes or folders in the Basecamp sync settings first.'); return; }
      // Index identities across the vault, including notes outside the selection, to detect copied mappings.
      const all: Note[] = [];
      this.bindings.clear();
      for (const file of this.app.vault.getMarkdownFiles()) {
        const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.basecamp_sync;
        if (!value) continue;
        const note = await this.readNote(file.path);
        all.push(note);
      }
      this.engine = new SyncEngine({ read: path => this.readNote(path),
        saveBinding: (path, binding) => this.saveBinding(path, binding),
        render: (note, upload) => this.render(note, upload) }, this.gateway(), this.activeSettings);
      const progress = background ? undefined : new Notice('Syncing selected notes to Basecamp…', 0);
      let results: SyncResult[];
      try {
        results = await this.engine.run(targetPaths, all);
        // New documents acquire URLs during the first pass. Resolve inter-note links in one bounded follow-up pass.
        if (results.some(result => result.status === 'created') && !this.unloading && !this.engine.isCancelled()) {
          const refreshed = await Promise.all([...new Set([...all.map(note => note.path), ...targetPaths])].map(path => this.readNote(path)));
          const linked = await this.engine.run(targetPaths.filter(path => !results.some(r => r.path === path && r.status === 'error')), refreshed);
          results = results.map(result => {
            const followup = linked.find(item => item.path === result.path);
            return followup?.status === 'error' ? followup : result;
          });
        }
      } finally { progress?.hide(); }
      const errors = results.filter(result => result.status === 'error');
      if (!background || errors.length) this.showResults(results);
      else if (results.some(result => result.status === 'created' || result.status === 'updated'))
        new Notice('Selected notes synced to Basecamp.');
    } catch (error) { this.report(error); }
    finally { this.engine = undefined; this.activeSettings = undefined; this.api = undefined; this.working = false; }
  }

  async showPlan(): Promise<void> {
    try {
      const notes = await Promise.all(this.selectedFiles().map(file => this.readNote(file.path)));
      const modal = new Modal(this.app);
      modal.setTitle('Preview Basecamp sync');
      const count = notes.filter(note => !note.disabled).length;
      modal.contentEl.createEl('p', { text: `${count} selected ${count === 1 ? 'note' : 'notes'}. New documents are visible to project members. Linked documents are updated when their content changes.` });
      if (this.settings.sourceFolder) modal.contentEl.createEl('p', { text: `Source folder: ${this.settings.sourceFolder}. Paths below it map into the selected Basecamp destination.` });
      const list = modal.contentEl.createEl('ul');
      for (const note of notes.slice(0, 200)) {
        const relative = relativeNotePath(note.path, this.settings.sourceFolder)!;
        const folder = this.settings.mirrorFolders ? relative.split('/').slice(0, -1).join('/') : '';
        const destination = [folder, note.title].filter(Boolean).join('/');
        list.createEl('li', { text: note.binding?.document
          ? `${note.path} — linked; keeps its current Basecamp location`
          : `${note.path} → ${destination} — new` });
      }
      if (notes.length > 200) modal.contentEl.createEl('p', { text: `And ${notes.length - 200} more notes.` });
      new Setting(modal.contentEl).addButton(button => button.setButtonText('Sync selected notes').setCta()
        .onClick(() => { modal.close(); void this.sync(); }));
      modal.open();
    } catch (error) { this.report(error); }
  }
  async previewCurrent(): Promise<void> {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) return;
      const rendered = await this.render(await this.readNote(file.path), false);
      const modal = new Modal(this.app);
      modal.setTitle('Basecamp formatting preview');
      modal.contentEl.createEl('p', { text: 'Local preview. Attachments appear as links here and upload when you sync.' });
      const preview = modal.contentEl.createDiv({ cls: 'basecamp-sync-preview' });
      preview.appendChild(sanitizeHTMLToDom(rendered.html));
      for (const warning of rendered.warnings) modal.contentEl.createEl('p', { text: warning });
      modal.open();
    } catch (error) { this.report(error); }
  }
  private showResults(results: SyncResult[]): void {
    const modal = new Modal(this.app);
    modal.setTitle('Basecamp sync results');
    const counts = ['created', 'updated', 'unchanged', 'skipped', 'error'].map(status =>
      `${results.filter(result => result.status === status).length} ${status}`).join(', ');
    modal.contentEl.createEl('p', { text: counts });
    for (const result of results.filter(item => item.status === 'error' || item.warnings?.length)) {
      modal.contentEl.createEl('p', { text: `${result.path}: ${result.detail || result.warnings?.join(' ')}` });
    }
    modal.open();
  }
  async openCurrent(): Promise<void> {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) return;
      const binding = (await this.readNote(file.path)).binding;
      if (!binding?.document) { new Notice('This note is not linked to a Basecamp document yet.'); return; }
      window.open(documentUrl(binding.account, binding.project, binding.document));
    } catch (error) { this.report(error); }
  }
  linkCurrent(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const modal = new Modal(this.app);
    modal.setTitle('Link to an existing Basecamp document');
    modal.contentEl.createEl('p', { text: 'Paste the document URL or ID. Linking accepts its current Basecamp version as the baseline. The next sync replaces its title and content with this note. Review Basecamp edits before continuing.' });
    let input = '';
    new Setting(modal.contentEl).setName('Document URL or ID').addText(text => text.onChange(value => { input = value; }));
    new Setting(modal.contentEl).addButton(button => button.setButtonText('Link document').setCta().onClick(async () => {
      try {
        if (this.working) throw new Error('Wait for the current sync to finish.');
        let id = input.trim();
        if (/^https:/.test(id)) {
          const url = new URL(id);
          const match = /^\/(\d+)\/buckets\/(\d+)\/documents\/(\d+)/.exec(url.pathname);
          if (!['3.basecamp.com', 'app.basecamp.com'].includes(url.hostname) || !match ||
            match[1] !== this.settings.accountId || match[2] !== this.settings.projectId)
            throw new Error('Paste a document URL from the selected account and project.');
          id = match[3]!;
        }
        const document = await this.gateway().getDocument(positiveId(id));
        if (document.bucket?.id !== positiveId(this.settings.projectId) || document.status !== 'active')
          throw new Error('Choose an active document in the selected project.');
        const note = await this.readNote(file.path);
        await this.saveBinding(file.path, { id: note.binding?.id || crypto.randomUUID(),
          account: this.settings.accountId, project: positiveId(this.settings.projectId),
          root: positiveId(this.settings.vaultId), vault: positiveId(this.settings.vaultId),
          document: document.id, url: documentUrl(this.settings.accountId, positiveId(this.settings.projectId), document.id),
          remoteHash: await remoteHash(document), pending: false });
        modal.close();
        new Notice('Note linked. The next sync will push its current content.');
      } catch (error) { this.report(error); }
    }));
    modal.open();
  }
}
