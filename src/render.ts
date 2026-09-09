import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { sha256, stripFrontmatter } from './model';
import { removeComments } from './comments';

export interface LinkTarget {
  url?: string;
  sgid?: string;
  fingerprint?: string;
  warning?: string;
}
export interface RenderOptions {
  resolve: (target: string, embed: boolean) => Promise<LinkTarget>;
}
export interface Rendered {
  html: string;
  hash: string;
  warnings: string[];
}
const escape = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function safeUrl(value: string): boolean {
  // Reject invisible characters, protocol-relative URLs, and executable schemes.
  return !Array.from(value).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) &&
    /^(https?:\/\/|mailto:|obsidian:\/\/)/i.test(value);
}

export async function renderNote(markdown: string, options: RenderOptions): Promise<Rendered> {
  const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false });
  const warnings = new Set<string>();
  const dependencies: string[] = [];
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const rest = state.src.slice(state.pos);
    const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(rest);
    if (!match) return false;
    if (!silent) {
      const token = state.push('wiki', '', 0);
      const [target, ...alias] = match[2]!.split('|');
      token.content = alias.join('|') || target!;
      token.attrSet('target', target!);
      token.attrSet('embed', match[1] === '!' ? 'yes' : 'no');
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.paragraph_open = () => '<div>';
  // Basecamp gives divs no paragraph margins, so blank lines must be explicit.
  md.renderer.rules.paragraph_close = (tokens, index) =>
    tokens[index + 1]?.type === 'paragraph_open' ? '</div>\n<div><br></div>\n' : '</div>\n';
  md.renderer.rules.heading_open = () => '<h1>';
  md.renderer.rules.heading_close = () => '</h1>\n';
  md.renderer.rules.code_inline = (tokens, index) => `<strong>${escape(tokens[index]!.content)}</strong>`;
  md.renderer.rules.fence = md.renderer.rules.code_block = (tokens, index) =>
    `<pre>${escape(tokens[index]!.content)}</pre>\n`;
  md.renderer.rules.s_open = () => '<strike>';
  md.renderer.rules.s_close = () => '</strike>';
  md.renderer.rules.hr = () => '<div>———</div>\n';
  md.renderer.rules.ready_html = (tokens, index) => tokens[index]!.content;
  md.renderer.rules.text = (tokens, index) => escape(tokens[index]!.content
    .replace(/^\[ \] /, '☐ ').replace(/^\[[xX]\] /, '☑ '));

  const tokens = md.parse(removeComments(stripFrontmatter(markdown)), {});
  for (let index = 2; index < tokens.length; index++) {
    if (tokens[index - 2]!.type !== 'blockquote_open' || tokens[index]!.type !== 'inline') continue;
    const first = tokens[index]!.children?.[0];
    const callout = first?.type === 'text' ? /^\[!([\w-]+)\][+-]?(.*)$/.exec(first.content) : null;
    if (first && callout) {
      first.type = 'ready_html';
      const label = callout[2]!.trim() || callout[1]!.replace(/[_-]/g, ' ').toLowerCase();
      first.content = `<strong>${escape(label.charAt(0).toUpperCase() + label.slice(1))}</strong>`;
    }
  }
  async function resolve(tokens: Token[]): Promise<void> {
    for (const token of tokens) {
      if (token.children) await resolve(token.children);
      const wiki = token.type === 'wiki';
      const embed = token.type === 'image' || (wiki && token.attrGet('embed') === 'yes');
      if (!wiki && token.type !== 'image' && token.type !== 'link_open') continue;
      const target = token.attrGet(wiki ? 'target' : embed ? 'src' : 'href') || '';
      if (/^(https?:\/\/|mailto:)/i.test(target) && safeUrl(target)) {
        if (embed) {
          warnings.add('Remote images are linked; only local attachments are uploaded.');
          token.type = 'ready_html';
          token.content = `<a href="${escape(target)}">${escape(token.content || 'Image')}</a>`;
          token.children = null;
        }
        continue;
      }
      const link = await options.resolve(target, embed);
      dependencies.push(`${target}:${link.fingerprint || link.url || ''}`);
      if (link.warning) warnings.add(link.warning);
      if (embed || wiki) {
        token.type = 'ready_html';
        const label = escape(token.content || target);
        token.content = link.sgid
          ? `<bc-attachment sgid="${escape(link.sgid)}" caption="${label}"></bc-attachment>`
          : link.url && safeUrl(link.url) ? `<a href="${escape(link.url)}">${label}</a>` : label;
        token.children = null;
      } else {
        token.attrs = link.url && safeUrl(link.url) ? [['href', link.url]] : [];
      }
    }
  }
  await resolve(tokens);

  // Basecamp strips table tags. Preserve cells, inline formatting and links as labeled rows.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== 'table_open') continue;
    const headers: string[] = [];
    const rows: string[][] = [];
    let inHead = true;
    let row: string[] = [];
    let end = i + 1;
    for (; end < tokens.length && tokens[end]!.type !== 'table_close'; end++) {
      const token = tokens[end]!;
      if (token.type === 'thead_close') inHead = false;
      if (token.type === 'tr_open') row = [];
      if (token.type === 'inline') {
        if (inHead) headers.push(escape(token.content));
        else row.push(md.renderer.renderInline(token.children || [], md.options, {}));
      }
      if (token.type === 'tr_close' && !inHead) rows.push(row);
    }
    const table = tokens[i]!;
    table.type = 'ready_html';
    table.content = rows.length ? rows.map(cells => `<div>${cells.map((cell, index) =>
      `<strong>${headers[index] || `Column ${index + 1}`}:</strong> ${cell}`).join('<br>')}</div>\n`).join('')
      : `<div>${headers.join(' · ')}</div>\n`;
    tokens.splice(i + 1, end - i);
  }
  const html = md.renderer.render(tokens, md.options, {});
  // Formatting changes also refresh already-synced notes whose Markdown is unchanged.
  const hash = await sha256(JSON.stringify([html, dependencies]));
  return { html, hash, warnings: [...warnings] };
}
