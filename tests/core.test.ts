import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Binding, type Note, parseBinding, stripFrontmatter } from '../src/model';
import type { Gateway, RemoteDocument } from '../src/basecamp';
import { relativeNotePath, selection } from '../src/selection';
import { renderNote } from '../src/render';
import { remoteHash, SyncEngine } from '../src/sync';

const settings = { ...DEFAULT_SETTINGS, accountId: '1', projectId: '2', vaultId: '3', includes: ['Work'] };
const render = (note: Note) => renderNote(note.markdown, {
  resolve: async () => ({ url: 'https://example.com/note' }) });

function setup() {
  const note: Note = { path: 'Work/Plan.md', title: 'Plan', markdown: '# Hello\n\nA **bold** plan.' };
  const documents = new Map<number, RemoteDocument>();
  const api: Gateway = {
    validateDestination: vi.fn(async () => {}),
    getDocument: vi.fn(async id => { if (!documents.has(id)) throw new Error('Not found'); return documents.get(id)!; }),
    createDocument: vi.fn(async (_vault, title, content) => {
      const document = { id: 10, title, content, bucket: { id: 2 }, status: 'active' };
      documents.set(10, document); return document;
    }),
    updateDocument: vi.fn(async (id, title, content) => {
      const document = { id, title, content, bucket: { id: 2 }, status: 'active' };
      documents.set(id, document); return document;
    }),
    listFolders: vi.fn(async () => []), createFolder: vi.fn(async (_parent, title) => ({ id: 4, title })),
    upload: vi.fn(async () => 'attachment'),
  };
  const save = vi.fn(async (_path: string, binding: Binding) => { note.binding = { ...binding }; });
  const host = { read: async () => ({ ...note }), saveBinding: save, render: async (note: Note) => render(note) };
  return { note, api, save, documents, engine: new SyncEngine(host, api, settings), host };
}

async function legacySetup() {
  const state = setup();
  state.note.markdown = 'Hello';
  const document = { id: 10, title: 'Plan', bucket: { id: 2 }, status: 'active',
    content: '<div dir="auto">Hello</div>\n<div dir="auto"><a>Open in Obsidian</a></div>' +
      '<div dir="auto"><a href="https://3.basecamp.com/1/buckets/2/vaults/4?basecamp-sync-id=legacy-note-identity">Basecamp folder</a></div>' };
  state.documents.set(10, document);
  state.note.binding = { id: 'legacy-note-identity', account: '1', project: 2, root: 3, vault: 4, document: 10,
    // Fingerprint produced by 0.1.4 for this note in the vault "Test".
    sourceHash: 'c9bf04d2ecb385d3443e737fc56d7800d24c91dbe3836a0cc42ed52c41181472',
    remoteHash: await remoteHash(document), pending: false };
  return state;
}

describe('selection and metadata', () => {
  it('selects nothing by default and respects folder boundaries', () => {
    expect(selection([], [])('Work/Plan.md')).toBe(false);
    const matches = selection(['Work'], ['Work/Private']);
    expect(matches('Work/Plan.md')).toBe(true);
    expect(matches('Workish/Plan.md')).toBe(false);
    expect(matches('Work/Private/Plan.md')).toBe(false);
    expect(matches('Work/image.png')).toBe(false);
  });
  it('supports glob zero-depth, recursive depth, literal dots and exact note paths', () => {
    const matches = selection(['Work/**/*.md', 'Inbox.md'], ['**/secret?.md']);
    for (const path of ['Work/Plan.md', 'Work/a/b/Plan.md', 'Inbox.md']) expect(matches(path)).toBe(true);
    for (const path of ['Work/secrets.md', 'Else/Inbox.md', '.obsidian/private.md']) expect(matches(path)).toBe(false);
  });
  it('maps paths below a source folder and restricts selection to that subtree', () => {
    const root = 'Projects/Writing/Basecamp';
    const path = `${root}/Standalone Content/External Highlights/KARS/Note.md`;
    expect(relativeNotePath(path, `./${root}/`)).toBe('Standalone Content/External Highlights/KARS/Note.md');
    expect(relativeNotePath(path, '')).toBe(path);
    expect(relativeNotePath(`${root}-private/Note.md`, root)).toBeUndefined();
    const matches = selection(['**/*.md'], ['**/Private/**'], root);
    expect(matches(path)).toBe(true);
    expect(matches(`${root}/Private/Note.md`)).toBe(false);
    expect(matches(`${root}-private/Note.md`)).toBe(false);
    expect(matches('Elsewhere/Note.md')).toBe(false);
    for (const invalid of ['../Projects', 'Projects/../Writing', '/Users/me/Notes', 'Projects/**'])
      expect(() => selection(['**/*.md'], [], invalid)).toThrow('Source folder');
  });
  it('removes all note properties and rejects unclosed YAML', () => {
    expect(stripFrontmatter('---\nsecret: hidden\n---\nHello')).toBe('Hello');
    expect(() => stripFrontmatter('---\nsecret: hidden')).toThrow('Unclosed');
    expect(stripFrontmatter('---\n---\nHello')).toBe('Hello');
    expect(stripFrontmatter('---\r\n---\r\nHello')).toBe('Hello');
  });
  it('validates persisted mappings rather than trusting arbitrary frontmatter', () => {
    expect(parseBinding(false)).toBeUndefined();
    expect(() => parseBinding({ id: 'oops', account: 'x' })).toThrow();
  });
});

describe('formatted content', () => {
  it('uses only supported formatting and keeps table links', async () => {
    const rendered = await renderNote('## Heading\n\n**Bold** *italic* ~~strike~~ `code`\n\n- [x] Done\n\n```ts\n<x>\n```\n\n| Name | Link |\n|---|---|\n| Alice | [Page](https://example.com) |',
      { resolve: async () => ({}) });
    expect(rendered.html).toContain('<h1>Heading</h1>');
    expect(rendered.html).toContain('<strike>strike</strike>');
    expect(rendered.html).toContain('☑ Done');
    expect(rendered.html).toContain('<pre>&lt;x&gt;');
    expect(rendered.html).toContain('<strong>Name:</strong> Alice');
    expect(rendered.html).toContain('href="https://example.com"');
    expect(rendered.html).not.toMatch(/<(?:table|p|h2|code|input|img)\b/);
  });
  it('escapes HTML, unsafe links and hostile attachment labels', async () => {
    const result = await renderNote('<script>alert(1)</script>\n\n[[attack|<img onerror=x>]]\n\n![[pic.png|" onload="bad]]', {
      resolve: async target => target === 'attack' ? { url: 'javascript:alert(1)' } : { sgid: 'safe"bad' },
    });
    expect(result.html).not.toMatch(/<script|<img|href="javascript/);
    expect(result.html).toContain('sgid="safe&quot;bad"');
    expect(result.html).toContain('&lt;img onerror=x&gt;');
  });
  it('resolves wikilinks and attachments without transcluding arbitrary notes', async () => {
    const resolver = vi.fn(async (target: string, embed: boolean) => ({
      url: 'https://example.com/' + target, sgid: embed && target.endsWith('.png') ? 'sgid' : undefined,
    }));
    const result = await renderNote('[[Plan|Next]] and ![[image.png]] and `[[literal]]`', { resolve: resolver });
    expect(result.html).toContain('>Next</a>');
    expect(result.html).toContain('<bc-attachment sgid="sgid"');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(result.html).toContain('[[literal]]');
  });
  it('excludes comments and frontmatter from publication', async () => {
    const result = await renderNote('---\nsecret: value\n---\nVisible %%private%% text', { resolve: async () => ({}) });
    expect(result.html).not.toMatch(/secret|private/);
    expect(result.html).toContain('Visible');
  });
  it('omits multiline comments while preserving literal comments in code', async () => {
    const result = await renderNote('Visible\n\n%%\nprivate\n\nsecret\n%%\n\n`%%literal%%`\n\n```\n%%code%%\n```', { resolve: async () => ({}) });
    expect(result.html).not.toMatch(/private|secret/);
    expect(result.html).toContain('%%literal%%');
    expect(result.html).toContain('%%code%%');
  });
  it('publishes only note content without a footer or hidden sync marker', async () => {
    const result = await renderNote('Hello', { resolve: async () => ({}) });
    expect(result.html).toBe('<div>Hello</div>\n');
  });
  it('preserves source links intentionally written in the note', async () => {
    const result = await renderNote('[[Plan|Open in Obsidian]]', {
      resolve: async () => ({ url: 'obsidian://open?vault=Test&file=Plan.md' }),
    });
    expect(result.html).toBe('<div><a href="obsidian://open?vault=Test&amp;file=Plan.md">Open in Obsidian</a></div>\n');
  });
  it('renders a callout label without raw Obsidian markers', async () => {
    const result = await renderNote('> [!NOTE]\n> Useful context.', { resolve: async () => ({}) });
    expect(result.html).toContain('<strong>Note</strong>');
    expect(result.html).not.toContain('[!NOTE]');
  });
});

describe('sync engine', () => {
  it('removes the old footer from an unchanged note on its next sync, then returns to no-op updates', async () => {
    const { engine, api, note, documents } = await legacySetup();
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('updated');
    expect(api.createDocument).not.toHaveBeenCalled();
    expect(api.updateDocument).toHaveBeenCalledWith(10, 'Plan', '<div>Hello</div>\n');
    expect(documents.get(10)?.content).toBe('<div>Hello</div>\n');
    expect(note.markdown).toBe('Hello');
    expect(note.binding?.document).toBe(10);
    vi.mocked(api.getDocument).mockClear();
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('unchanged');
    expect(api.getDocument).not.toHaveBeenCalled();
    expect(api.updateDocument).toHaveBeenCalledTimes(1);
  });
  it('protects remote edits during the old-footer cleanup', async () => {
    const { engine, api, note, documents } = await legacySetup();
    documents.set(10, { ...documents.get(10)!, content: 'Edited in Basecamp' });
    expect((await engine.run([note.path], [note]))[0]?.detail).toContain('changed since');
    expect(api.updateDocument).not.toHaveBeenCalled();
    expect(api.createDocument).not.toHaveBeenCalled();
  });
  it('recreates only the folders below the source folder', async () => {
    const { api, note, host } = setup();
    note.path = 'Projects/Writing/Basecamp/Standalone Content/External Highlights/KARS/Note.md';
    let id = 4;
    vi.mocked(api.createFolder).mockImplementation(async (_parent, title) => ({ id: id++, title }));
    const engine = new SyncEngine(host, api, { ...settings, includes: ['Projects/**/*.md'], sourceFolder: 'Projects/Writing/Basecamp' });
    expect((await engine.run([note.path], []))[0]?.status).toBe('created');
    expect(api.createFolder).toHaveBeenNthCalledWith(1, 3, 'Standalone Content');
    expect(api.createFolder).toHaveBeenNthCalledWith(2, 4, 'External Highlights');
    expect(api.createFolder).toHaveBeenNthCalledWith(3, 5, 'KARS');
    expect(api.createFolder).toHaveBeenCalledTimes(3);
    expect(api.createDocument).toHaveBeenCalledWith(6, note.title, expect.any(String));
    expect(note.path).toBe('Projects/Writing/Basecamp/Standalone Content/External Highlights/KARS/Note.md');
  });
  it.each([
    ['Projects/Writing/Basecamp/Note.md', true],
    ['Projects/Writing/Basecamp/Nested/Note.md', false],
  ])('places %s at the destination with preserve folders %s', async (path, mirrorFolders) => {
    const { api, note, host } = setup(); note.path = path;
    const engine = new SyncEngine(host, api, { ...settings, includes: ['Projects'], sourceFolder: 'Projects/Writing/Basecamp', mirrorFolders });
    expect((await engine.run([path], []))[0]?.status).toBe('created');
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.createDocument).toHaveBeenCalledWith(3, note.title, expect.any(String));
  });
  it('reuses matching Basecamp folders below the destination', async () => {
    const { api, note, host } = setup(); note.path = 'Projects/Writing/Basecamp/KARS/Note.md';
    vi.mocked(api.listFolders).mockResolvedValue([{ id: 44, title: 'KARS' }]);
    const engine = new SyncEngine(host, api, { ...settings, includes: ['Projects'], sourceFolder: 'Projects/Writing/Basecamp' });
    expect((await engine.run([note.path], []))[0]?.status).toBe('created');
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.createDocument).toHaveBeenCalledWith(44, note.title, expect.any(String));
  });
  it('does not publish a note outside the source folder even with broad include patterns', async () => {
    const { api, note, host } = setup();
    const engine = new SyncEngine(host, api, { ...settings, includes: ['**/*.md'], sourceFolder: 'Projects/Writing/Basecamp' });
    expect((await engine.run([note.path], []))[0]?.status).toBe('skipped');
    expect(api.validateDestination).not.toHaveBeenCalled();
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.createDocument).not.toHaveBeenCalled();
  });
  it('updates an existing document in place after the source folder changes', async () => {
    const { engine, api, note, host } = setup();
    await engine.run([note.path], []);
    const vault = note.binding!.vault;
    vi.mocked(api.createFolder).mockClear();
    note.markdown = 'Updated';
    const changed = new SyncEngine(host, api, { ...settings, sourceFolder: 'Work' });
    expect((await changed.run([note.path], [note]))[0]?.status).toBe('updated');
    expect(api.createFolder).not.toHaveBeenCalled();
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(api.updateDocument).toHaveBeenCalledWith(10, note.title, expect.any(String));
    expect(note.binding!.vault).toBe(vault);
  });
  it('creates once, checkpoints before posting, and does no remote work on unchanged content', async () => {
    const { engine, api, save, note } = setup();
    expect((await engine.run([note.path], []))[0]?.status).toBe('created');
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.createDocument).mock.invocationCallOrder[0]!);
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('unchanged');
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(api.getDocument).not.toHaveBeenCalled();
    expect(api.updateDocument).not.toHaveBeenCalled();
  });
  it('updates the same document after edits or renames', async () => {
    const { engine, api, note } = setup();
    await engine.run([note.path], []);
    note.path = 'Work/Renamed.md'; note.title = 'Renamed'; note.markdown = 'New content';
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('updated');
    expect(api.updateDocument).toHaveBeenCalledWith(10, 'Renamed', expect.stringContaining('New content'));
    expect(api.createDocument).toHaveBeenCalledTimes(1);
  });
  it('protects remote edits and never uploads content on a conflict', async () => {
    const { engine, api, note, documents, host } = setup();
    await engine.run([note.path], []);
    documents.set(10, { ...documents.get(10)!, content: 'A colleague edited this' });
    note.markdown = 'My version';
    host.render = vi.fn(host.render);
    const result = await engine.run([note.path], [note]);
    expect(result[0]?.detail).toContain('changed since');
    expect(api.updateDocument).not.toHaveBeenCalled();
    expect(host.render).not.toHaveBeenCalledWith(expect.anything(), true);
  });
  it('does not recreate a missing remote document', async () => {
    const { engine, note, documents, api } = setup();
    await engine.run([note.path], []); documents.clear(); note.markdown = 'Edit';
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('error');
    expect(api.createDocument).toHaveBeenCalledTimes(1);
  });
  it('rejects copied identities, including copies outside selected folders', async () => {
    const { engine, note, api } = setup(); await engine.run([note.path], []);
    const copied = { ...note, path: 'Private/Copy.md' };
    expect((await engine.run([note.path], [note, copied]))[0]?.detail).toContain('Two notes');
    expect(api.updateDocument).not.toHaveBeenCalled();
  });
  it('rejects destination changes and archived documents', async () => {
    const { engine, note, documents, host, api } = setup(); await engine.run([note.path], []);
    const changed = new SyncEngine(host, api, { ...settings, accountId: '99' });
    expect((await changed.run([note.path], [note]))[0]?.detail).toContain('different destination');
    documents.set(10, { ...documents.get(10)!, status: 'archived' }); note.markdown = 'Edit';
    expect((await engine.run([note.path], [note]))[0]?.detail).toContain('archived');
  });
  it('stops after a lost create response and resumes only after the user links the existing document', async () => {
    const { engine, api, note, documents } = setup();
    const create = api.createDocument;
    vi.mocked(api.createDocument).mockImplementationOnce(async (...args) => {
      const document: RemoteDocument = { id: 10, title: args[1], content: args[2], bucket: { id: 2 }, status: 'active' };
      documents.set(10, document);
      throw new Error('Disconnected');
    });
    expect((await engine.run([note.path], []))[0]?.status).toBe('error');
    expect(note.binding?.pending).toBe(true);
    expect(documents.get(10)?.content).not.toMatch(/Open in Obsidian|Basecamp folder|basecamp-sync-id/);
    expect((await engine.run([note.path], [note]))[0]?.detail).toContain('unknown outcome');
    expect(create).toHaveBeenCalledTimes(1);
    expect(api.updateDocument).not.toHaveBeenCalled();
    expect(api.getDocument).not.toHaveBeenCalled();
    note.binding = { ...note.binding!, document: 10, remoteHash: await remoteHash(documents.get(10)!), pending: false };
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('updated');
    expect(create).toHaveBeenCalledTimes(1);
    expect(note.binding?.document).toBe(10);
  });
  it('does not retry an ambiguous create without a confirmed document ID', async () => {
    const { engine, api, note } = setup();
    vi.mocked(api.createDocument).mockRejectedValue(new Error('Offline'));
    await engine.run([note.path], []);
    expect((await engine.run([note.path], [note]))[0]?.detail).toContain('unknown outcome');
    expect(api.createDocument).toHaveBeenCalledTimes(1);
  });
  it('allows a later retry after a definitive rate-limit rejection', async () => {
    const { engine, api, note } = setup();
    vi.mocked(api.createDocument).mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { httpStatus: 429 }));
    await engine.run([note.path], []);
    expect(note.binding?.pending).toBe(false);
    expect((await engine.run([note.path], [note]))[0]?.status).toBe('created');
  });
  it('does not mark a failed attachment preparation as an ambiguous document create', async () => {
    const { engine, api, note, host } = setup();
    const original = host.render;
    host.render = vi.fn(async (note: Note, upload?: boolean) => {
      if (upload) throw new Error('Attachment failed');
      return original(note);
    });
    await engine.run([note.path], []);
    expect(note.binding?.pending).toBe(false);
    expect(api.createDocument).not.toHaveBeenCalled();
  });
  it('skips excluded notes without remote requests', async () => {
    const { engine, note, api } = setup(); note.disabled = true;
    expect((await engine.run([note.path], []))[0]?.status).toBe('skipped');
    expect(api.createDocument).not.toHaveBeenCalled();
  });
  it('keeps cancellation across link-repair passes', async () => {
    const { engine, note, api } = setup(); engine.cancel();
    expect(await engine.run([note.path], [])).toEqual([]);
    expect(api.createDocument).not.toHaveBeenCalled();
  });
  it('fingerprints both the remote title and canonical HTML', async () => {
    expect(await remoteHash({ id: 1, title: 'A', content: 'B' })).not.toBe(await remoteHash({ id: 1, title: 'B', content: 'A' }));
  });
});
