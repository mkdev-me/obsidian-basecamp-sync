# Release checklist

## Current verification

Automated tests run without credentials and do not write to a real Basecamp account. They cover note selection, safe formatting, stable updates, duplicate detection, conflict prevention, interrupted creates, OAuth callback state and verifier binding, refresh, native transport, and the actual bundled SDK under simulated mobile restrictions.

Desktop smoke check on 2026-09-07: the built plugin loaded successfully in Obsidian 1.13.7 on macOS using an isolated two-note test vault. Its native settings, registered commands, selected-note preview and formatted-content preview were exercised in the real app. Properties and private scratch comments were absent from the rendered preview. This check did not connect to or write to Basecamp.

The mkdev OAuth app and hosted login service were provisioned on 2026-09-07. HTTPS `/health` returns 200, login start points to the registered app and exact callback, and malformed requests are rejected. Terraform reports no changes after deployment. These checks do not authorize a Basecamp account or prove token renewal. Physical iOS/Android behavior, real Basecamp HTML normalization and end-to-end live publication must be checked before a public stable release. Do not claim those checks passed merely because the bundle compiles or mocks pass.

## Private BRAT releases

The repository is [mkdev-me/obsidian-basecamp-sync](https://github.com/mkdev-me/obsidian-basecamp-sync). Keep its visibility private during testing. BRAT 2.2.0 supports private repositories with a token that has read access to repository contents, and supports published pre-releases. Install instructions are in [README.md](../README.md#brat-desktop-and-mobile).

1. Update `manifest.json`, `package.json`, the lockfile version and `versions.json` together, and add release notes to `CHANGELOG.md`.
2. Run `npm run package`, push the commit, and confirm the **Check** workflow passes.
3. Create and push a tag matching the manifest version exactly, without a `v` prefix. For the initial release: `git tag -a 0.1.0 -m '0.1.0'` and `git push origin 0.1.0`.
4. The **Draft release** workflow builds and tests the tagged source, then attaches individual `main.js`, `manifest.json` and `styles.css` assets plus the manual-install ZIP.
5. Review the draft, mark it as a **pre-release**, and publish it. For the initial release: `gh release edit 0.1.0 --draft=false --prerelease --repo mkdev-me/obsidian-basecamp-sync`. Publishing a release does not change repository visibility.
6. Verify the published release and download the three assets using an account with repository access. Confirm the manifest ID is `basecamp-sync`, its version matches the tag, and the files match the build. Test installation/update through BRAT with a repository token.

A draft visible to a maintainer is insufficient for distribution to testers. BRAT needs the individual release assets, not just GitHub's automatic source archives or the ZIP. **Latest version** tracks new releases; choosing a specific version pins it. Future releases repeat this workflow with an incremented version.

## Before the first community submission

- [x] Register and deploy the shared integration using [authentication.md](authentication.md).
- [x] Set the deployed service URL in `DEFAULT_BROKER_URL` and use it for empty saved URLs.
- [ ] Complete the real-client acceptance tests below, recording app/OS versions and date.
- [ ] Review README, privacy policy, license, screenshots and the callback/service deployment instructions.
- [ ] Confirm the chosen `basecamp-sync` plugin ID is available in the current community directory.
- [ ] Push this source to a public GitHub repository controlled by mkdev. The repository must contain `README.md`, `LICENSE` and `manifest.json` at the root.
- [ ] Run `npm ci`, `npm run package` and `npm audit` from a clean checkout.
- [ ] Create a version tag that exactly matches `manifest.json`, for example `0.1.0` (no `v` prefix). Keep `package.json`, `manifest.json` and `versions.json` consistent.
- [ ] Attach the **individual** `main.js`, `manifest.json` and `styles.css` files to that GitHub release. A ZIP alone cannot be installed by the directory.
- [ ] Review and publish the draft release created by the included release workflow.
- [ ] Follow the current [Obsidian submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin): sign in to [community.obsidian.md](https://community.obsidian.md), link the owning GitHub account, add the plugin and resolve automated review feedback.

The current submission guide uses the community website. Do not assume that an older tutorial's pull request to `community-plugins.json` is the current submission workflow.

## Real-client acceptance tests

Use a dedicated test vault and a disposable Basecamp project. The plugin writes documents; choose a project where that is intended.

1. **Install on desktop and physical iOS.** Load the three built files and enable the plugin on Obsidian 1.11.4 or newer. Also test Android if advertising tested Android support. Check that no Node/Buffer/stream/AbortSignal errors occur.
2. **Authenticate.** Exercise the shared integration, a personal integration, cancelled consent, wrong/expired state, browser return, manual callback fallback and app suspension/restart during login.
3. **Refresh.** Test with an expired access token in an isolated development profile. Ensure the existing refresh token is retained if Basecamp omits a replacement. Verify reconnect after access is revoked.
4. **Selection.** Confirm an empty include list publishes nothing. Test an exact file, a recursive folder, nested globs, exclusions, an opted-out note and a current note outside the selection.
5. **Create and update.** Use headings, paragraphs, Unicode, bold/italic/strike, task lists, nested lists, code, callouts, tables with links, wiki links, local embedded images and a PDF. Compare the local preview with the Basecamp page. Record any sanitizer differences, especially custom Obsidian URI links.
6. **No-op.** Sync again without changes. Confirm no HTTP calls, no duplicate documents and no extra attachment uploads.
7. **Existing pages.** Link a pre-existing test document, sync it and confirm both title and body are replaced while the document identity, comments, visibility and subscriptions remain intact.
8. **Conflicts.** Edit the Basecamp document, then edit the note. Confirm sync stops. Reconcile the changes, explicitly relink and retry.
9. **Recovery.** Interrupt a create after the request is accepted, then retry. Confirm the HTTPS folder-link marker finds the existing page. Also test a pre-create attachment failure, a definitive 429 response, a lost update response and an ambiguous create with no matching result.
10. **Cross-device continuation.** Finish a desktop sync; let note properties reach iOS through the user's chosen vault sync method; connect on iOS and edit the note. Confirm the same Basecamp document is updated. Repeat in the other direction, with one writer at a time.
11. **Moves, copies and deletion.** Rename/move a note and verify the document stays linked. Copy it with its sync properties and verify the duplicate is blocked. Delete/exclude the original and confirm nothing is deleted in Basecamp.
12. **Rate limits, offline mode and suspension.** Verify errors identify the affected notes, queued work stops on unload, and retry does not blindly duplicate an uncertain create. There is no mobile background-sync guarantee.

## Sources

- [Obsidian build guide](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Obsidian plugin submission requirements](https://docs.obsidian.md/Community%20directory/Submission%20requirements%20for%20plugins)
- [Obsidian Secret storage](https://docs.obsidian.md/Plugins/Guides/Store%20secrets)
- [Basecamp rich-text HTML and attachments](https://github.com/basecamp/bc-api/blob/master/sections/rich_text.md)
- [Basecamp authentication](https://github.com/basecamp/bc-api/blob/master/sections/authentication.md)
- [Official SDK and document update semantics](https://github.com/basecamp/basecamp-sdk/tree/main/typescript)
