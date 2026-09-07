import { mkdir, readFile, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
if (pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion ||
  !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.isDesktopOnly !== false ||
  manifest.id !== 'basecamp-sync') throw new Error('Manifest, package and version history must agree.');
const folder = `dist/${manifest.id}`;
await mkdir(folder, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(file, `${folder}/${file}`);
const archive = `${manifest.id}-${manifest.version}.zip`;
await rm(`dist/${archive}`, { force: true });
execFileSync('zip', ['-q', '-r', archive, manifest.id], { cwd: 'dist' });
console.log(`Packaged ${folder}/ and dist/${archive}`);
