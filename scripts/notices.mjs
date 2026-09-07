import { readFile } from 'node:fs/promises';

export async function thirdPartyNotices(inputs) {
  const packages = new Set();
  for (const [path, metadata] of Object.entries(inputs)) {
    const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
    if (match && metadata.bytesInOutput > 0) packages.add(match[1]);
  }
  const notices = ['Third-party software included in Basecamp Sync.\n'];
  for (const name of [...packages].sort()) {
    // SDK 0.16.0's npm tarball omits its license; retain the upstream tagged license locally.
    let license = name === '@37signals/basecamp' ? await readFile('third-party/basecamp-sdk-LICENSE', 'utf8') : undefined;
    for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENSE-MIT.txt', 'LICENSE-MIT']) {
      try { license = await readFile(`node_modules/${name}/${filename}`, 'utf8'); break; } catch { /* Try the next conventional name. */ }
    }
    if (!license) throw new Error(`Missing distribution license for bundled package ${name}.`);
    notices.push(`\n--- ${name} ---\n\n${license.trim()}\n`);
  }
  return notices.join('');
}
