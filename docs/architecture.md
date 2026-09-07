# Architecture

The runtime consists of a small Obsidian shell around a testable one-way sync engine. There is one account/project/destination configuration per vault and a sequential queue. No database, workers, long-running background poller or generic integration framework is involved.

- `src/main.ts`: vault access, commands, local previews, attachment resolution and device-specific edit scheduling.
- `src/settings.ts`: native Obsidian controls. Uses the imperative settings API to retain compatibility with Obsidian 1.11.4.
- `src/selection.ts`: vault-relative paths and minimal glob matching.
- `src/render.ts` / `comments.ts`: markdown-it parsing and explicit Basecamp-compatible output. No Markdown HTML or third-party renderer execution.
- `src/sync.ts`: identity, change detection, destination checks, create/update checkpoints, conflict detection and recovery.
- `src/basecamp.ts`: the official SDK's typed document, vault, project and attachment services.
- `src/transport.ts` / `sdk-fetch.ts`: Obsidian `requestUrl` adapted to Fetch, ETag revalidation and small mobile compatibility helpers.
- `src/auth.ts`: SDK OAuth helpers, device-local credentials, callback state validation and single-flight refresh.
- `broker/server.mjs`: optional single-process, bounded, short-lived OAuth handoff service for a shared integration.

## Stored state

| Location | Contents |
| --- | --- |
| Note properties, `basecamp_sync` | Stable identity, account/project/root/vault/document IDs, generated document URL, content fingerprints and pending-create marker |
| Plugin `data.json` | Selection and destination settings, names of user-managed secret entries, and per-document attachment hashes/references |
| Obsidian Secret storage | OAuth session, pending login, selected personal client secret or access token |
| Obsidian device-local storage | Whether automatic sync is enabled on this device |
| Memory only | Bounded HTTP body cache (64 entries, 8 MB total, 1 MB per entry), attachment digest cache and current queue |

Note properties are the cross-device source of document identity. They must arrive on another device before that device publishes the note. All note properties are excluded from the published body. Obsidian links include vault/note names and the recovery identity, so Basecamp project readers can see those names.

## Mobile adaptation of SDK 0.16.0

The official SDK is distributed with CLI helpers and assumes native Fetch. Three scoped build adaptations keep the shipped plugin portable:

1. Bind bundled Fetch calls to the Obsidian transport, without replacing `window.fetch` or changing other plugins.
2. Replace SDK static AbortSignal helpers with local implementations for older WebViews. Discard unused Node CLI exports and fold the dependency's guarded Node detection to its browser branch.
3. In the pinned SDK's request-timeout middleware, clone the original `Request` instead of constructing a request from its `ReadableStream` body. Safari does not support streamed request-body construction. The exact source match is checked at build time and intentionally fails on an unexpected SDK upgrade.

SDK ETag caching is disabled because its synthesized cached response loses the URL/pagination metadata needed by its own paginators. The native transport instead revalidates cached GETs with `If-None-Match`, isolates cache entries by bearer authorization and URL, and restores both original URL and Link headers on a 304.

The final bundle audit rejects runtime imports other than `obsidian`, and rejects Node `Buffer`/`process` use. A VM integration test loads the actual bundle with no Node runtime globals, no AbortSignal static helpers, and a Request constructor that rejects streamed upload bodies. It exercises real SDK pagination, cache revalidation, origin checks, document replacement and binary uploads.

Obsidian's native HTTP API cannot cancel an in-flight native request. Cancellation stops waiting and prevents subsequent engine operations; an in-flight write can still complete. The pending-create checkpoint and explicit unknown-outcome behavior handle that case. It also does not expose redirect-chain inspection: configured login services and Basecamp endpoints must not redirect credential-bearing requests to another origin.

## Deliberate limits

The Basecamp document API has no atomic compare-and-swap. The engine checks canonical title/content fingerprints both before preparation and immediately before replacing a changed document, but another writer can still race the final request. Unchanged local content does not fetch or overwrite the remote document. Create requests are never blindly retried after ambiguous failures. Known definitive rejections clear the pending-create flag so a later manual retry is possible.

Remote identity is never inferred from a title. Interrupted creates are recovered only by an exact per-note marker; duplicate identities anywhere in the vault block publication. Existing document moves and remote deletions are deliberately not mirrored. Bulk cross-device coordination, two-way merging and server-hosted sync are outside this release.
