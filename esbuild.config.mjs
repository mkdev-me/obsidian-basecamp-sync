import esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { thirdPartyNotices } from './scripts/notices.mjs';

const watch = process.argv.includes('--watch');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'main.js',
  format: 'cjs', platform: 'browser', target: ['es2022', 'safari16'],
  external: ['obsidian'], minify: !watch, sourcemap: watch ? 'inline' : false,
  treeShaking: true, metafile: true, legalComments: 'eof',
  define: { 'globalThis.fetch': '__basecampFetch', fetch: '__basecampFetch', process: 'undefined',
    'AbortSignal.any': '__basecampAbortAny', 'AbortSignal.timeout': '__basecampAbortTimeout' },
  inject: ['src/sdk-fetch.ts'],
  plugins: [{
    name: 'exclude-unused-sdk-desktop-helpers',
    setup(build) {
      build.onLoad({ filter: /@37signals\/basecamp\/dist\/client\.js$/ }, async args => {
        const source = await readFile(args.path, 'utf8');
        // SDK 0.16 creates a streamed request body while attaching a timeout. Safari cannot
        // construct upload streams, even though requestUrl accepts the eventual bytes.
        // Native Request cloning preserves the body without requiring upload-stream support.
        const pattern = /return new Request\(request\.url, \{\s*method: request\.method,\s*headers: request\.headers,\s*body: request\.body,\s*signal,\s*duplex: request\.body \? "half" : undefined,\s*\}\);/g;
        if ([...source.matchAll(pattern)].length !== 1) throw new Error('Review the SDK mobile Request adapter after upgrading.');
        return { contents: source.replace(pattern, 'return new Request(request, { headers: request.headers, signal });'), loader: 'js' };
      });
      // The SDK re-exports CLI helpers. They are unused, and must disappear entirely.
      build.onResolve({ filter: /^node:/ }, args => ({ path: args.path, external: true, sideEffects: false }));
      build.onEnd(async result => {
        if (result.errors.length || watch) return;
        let output = await readFile('main.js', 'utf8');
        const imports = result.metafile.outputs['main.js'].imports.map(item => item.path);
        if (imports.some(path => path !== 'obsidian') || /\b(?:Buffer|process)\./.test(output))
          throw new Error('Desktop-only code leaked into the mobile bundle.');
        const notices = await thirdPartyNotices(result.metafile.outputs['main.js'].inputs);
        await writeFile('THIRD_PARTY_NOTICES.txt', notices);
        output += `\n/*!\n${notices.replaceAll('*/', '* /')}\n*/\n`;
        await writeFile('main.js', output);
        await writeFile('build-meta.json', JSON.stringify({ bytes: Buffer.byteLength(output), imports }, null, 2));
        console.log(`Mobile bundle: ${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB; only external: obsidian`);
      });
    },
  }],
});
if (watch) await context.watch();
else { await context.rebuild(); await context.dispose(); }
