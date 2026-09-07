# Contributing

Use Node.js 22.12 or newer. Run `npm ci`, then `npm run check`. To test in Obsidian, use a dedicated test vault; never point development credentials at a project where accidental publication would matter.

Keep this plugin focused on one-way document publication. Prefer native Obsidian UI and browser APIs. Avoid Node/Electron APIs in runtime code, global patches, background polling and heavy UI frameworks. New dependencies need a clear benefit and a bundle-size check.

Tests should cover observable behavior: selection boundaries, formatting preservation, remote conflicts, identity safety, recovery and authentication. All automated tests must stay independent of live accounts and secrets. Do not add credentials, plugin `data.json`, real note contents or customer screenshots to fixtures.

When changing the SDK version, inspect its OAuth and document semantics, update the scoped mobile adapters if necessary, and run the actual-bundle tests. The build intentionally fails if the known Request compatibility patch no longer matches.

Before opening a pull request, run `npm run package` and describe the behavior changed, tests performed and remaining device/live-service checks. See [docs/releasing.md](docs/releasing.md) for publication requirements.
