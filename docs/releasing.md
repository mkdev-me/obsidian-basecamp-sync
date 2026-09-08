# Release checklist

## Current verification

Automated tests run without credentials and do not write to a real Basecamp account. They cover note selection, safe formatting, stable updates, duplicate detection, conflict prevention, interrupted creates, OAuth callback state and verifier binding, refresh, native transport, and the actual bundled SDK under simulated mobile restrictions.

Desktop smoke check on 2026-09-07: the built plugin loaded successfully in Obsidian 1.13.7 on macOS using an isolated two-note test vault. Its native settings, registered commands, selected-note preview and formatted-content preview were exercised in the real app. Properties and private scratch comments were absent from the rendered preview. This check did not connect to or write to Basecamp.

Live desktop checks on 2026-09-08 in Obsidian 1.13.7 on macOS verified shared-integration login, document creation and source-folder mapping into existing Basecamp folders. Version 0.1.5 then updated the same document to remove its old footer, preserving its document ID, parent folder and authored text; the run reported one update and no errors.

On 2026-09-08, the maintainer reported that syncing works on physical iOS and confirmed authentication was needed only for the first connection on that device. This is expected because credentials are device-local. Exact iOS and Obsidian versions and individual test scenarios were not recorded, so this confirms basic iOS use rather than every acceptance case below.

On 2026-09-08, the maintainer instructed that the focused checks for automatic token renewal, image/file uploads and updating the same document across desktop and iOS be treated as complete for this release. This is maintainer release acceptance; no additional independent test results or device versions were recorded for those checks.

The mkdev OAuth app and hosted login service were provisioned on 2026-09-07. HTTPS `/health` returned 200, login start pointed to the registered app and exact callback, and malformed requests were rejected. Terraform reported no changes after deployment. Android has not been exercised on a physical device. The broader regression checklist below is retained for future validation; it is not a claim that every scenario has been run on every device.

## GitHub releases

The plugin repository is [mkdev-me/obsidian-basecamp-sync](https://github.com/mkdev-me/obsidian-basecamp-sync). Versions 0.1.0–0.1.5 were private BRAT prereleases; 0.1.6 is prepared as the first public release. The hosted login service remains in mkdev's private infrastructure repository, as disclosed in the README.

1. Update `manifest.json`, `package.json`, the lockfile version and `versions.json` together, and add release notes to `CHANGELOG.md`.
2. Run `npm run package`, push the commit, and confirm the **Check** workflow passes.
3. Create and push a tag matching the manifest version exactly, without a `v` prefix.
4. The **Draft release** workflow builds and tests the tagged source, then attaches individual `main.js`, `manifest.json` and `styles.css` assets plus the manual-install ZIP.
5. Review the draft and publish it as a normal release. Use the prerelease flag only for future beta builds. Publishing a release does not change repository visibility.
6. Download the three assets without GitHub authentication. Confirm the manifest ID is `basecamp-sync`, its version matches the tag, and the files match the tested build. Installation instructions are in the README.

A draft visible to a maintainer is insufficient for distribution to testers. BRAT needs the individual release assets, not just GitHub's automatic source archives or the ZIP. **Latest version** tracks new releases; choosing a specific version pins it. Future releases repeat this workflow with an incremented version.

## Before the first community submission

- [x] Register and deploy the shared integration using [authentication.md](authentication.md).
- [x] Set the deployed service URL in `DEFAULT_BROKER_URL` and use it for empty saved URLs.
- [x] Obtain maintainer acceptance of the focused desktop/iOS release checks; see the verification record above.
- [x] Review README, privacy policy, license, screenshot and the callback/service deployment instructions.
- [x] Check the published community directory for `basecamp-sync`; no matching ID or Basecamp entry was present on 2026-09-08. The submission form makes the final availability check.
- [ ] Push this source to a public GitHub repository controlled by mkdev. The repository must contain `README.md`, `LICENSE` and `manifest.json` at the root.
- [x] Run `npm ci`, `npm run package` and `npm audit` for 0.1.6: 51 tests, lint, typecheck and mobile bundle check passed; no dependency vulnerabilities were reported.
- [ ] Create a version tag that exactly matches `manifest.json` (no `v` prefix). Keep `package.json`, `manifest.json` and `versions.json` consistent.
- [ ] Attach the **individual** `main.js`, `manifest.json` and `styles.css` files to that GitHub release. A ZIP alone cannot be installed by the directory.
- [ ] Review and publish the draft release created by the included release workflow.
- [ ] Follow the current [Obsidian submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin): sign in to [community.obsidian.md](https://community.obsidian.md), link the owning GitHub account, add the plugin and resolve automated review feedback.

The current submission guide uses the community website. Do not assume that an older tutorial's pull request to `community-plugins.json` is the current submission workflow.

### Submission details

- Repository: `https://github.com/mkdev-me/obsidian-basecamp-sync`
- Plugin ID: `basecamp-sync`
- Name: **Basecamp Sync**
- Description: **Sync selected notes and folders to formatted Basecamp documents.**
- Release: **0.1.6**
- Screenshot: `docs/images/selection-preview.png` (already embedded in the README)

Sign in with the maintainer's Obsidian account and connect the GitHub account that can verify repository ownership. In **Plugins → New plugin**, enter the repository URL and choose the existing mkdev community organization if available, or the maintaining account. The owner must accept the developer policies and confirm continued support, or removal/transfer if maintenance ends. Submit, then resolve any review errors before publishing the listing.

## Real-client regression checklist

Use a dedicated test vault and a disposable Basecamp project. The plugin writes documents; choose a project where that is intended.

1. **Install on desktop and physical iOS.** Load the three built files and enable the plugin on Obsidian 1.11.4 or newer. Also test Android if advertising tested Android support. Check that no Node/Buffer/stream/AbortSignal errors occur.
2. **Authenticate.** Exercise the shared integration, a personal integration, cancelled consent, wrong/expired state, browser return, manual callback fallback and app suspension/restart during login.
3. **Refresh.** Test with an expired access token in an isolated development profile. Ensure the existing refresh token is retained if Basecamp omits a replacement. Verify reconnect after access is revoked.
4. **Selection and folder mapping.** Confirm an empty include list publishes nothing. Test an exact file, a recursive folder, nested globs, exclusions, an opted-out note and a current note outside the selection. Set Source folder to a nested vault folder and confirm only its descendants are selected, the preview shows relative Basecamp paths, and no ancestor folders are created. Check existing matching Basecamp folders are reused. Changing Source folder must keep linked documents in place.
5. **Create and update.** Use headings, paragraphs, Unicode, bold/italic/strike, task lists, nested lists, code, callouts, tables with links, wiki links, local embedded images and a PDF. Compare the local preview with the Basecamp page. Confirm no source/footer links or hidden sync markers are added. Upgrade an unchanged note from 0.1.4 and confirm its next sync removes the old footer while keeping its document ID; repeat with a remote edit and confirm cleanup stops for the conflict. Record any sanitizer differences, especially custom Obsidian URI links written in the note.
6. **No-op.** Sync again without changes. Confirm no HTTP calls, no duplicate documents and no extra attachment uploads.
7. **Existing pages.** Link a pre-existing test document, sync it and confirm both title and body are replaced while the document identity, comments, visibility and subscriptions remain intact.
8. **Conflicts.** Edit the Basecamp document, then edit the note. Confirm sync stops. Reconcile the changes, explicitly relink and retry.
9. **Recovery.** Interrupt a create after the request is accepted, then retry. Confirm sync stops with an unknown-outcome message and does not create a duplicate. Explicitly link the existing document and confirm sync resumes. Also test a pre-create attachment failure, a definitive 429 response, a lost update response and an ambiguous create where no document exists.
10. **Cross-device continuation.** Finish a desktop sync; let note properties reach iOS through the user's chosen vault sync method; connect on iOS and edit the note. Confirm the same Basecamp document is updated. Repeat in the other direction, with one writer at a time.
11. **Moves, copies and deletion.** Rename/move a note and verify the document stays linked. Copy it with its sync properties and verify the duplicate is blocked. Delete/exclude the original and confirm nothing is deleted in Basecamp.
12. **Rate limits, offline mode and suspension.** Verify errors identify the affected notes, queued work stops on unload, and retry does not blindly duplicate an uncertain create. There is no mobile background-sync guarantee.

## Sources

- [Obsidian build guide](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Obsidian plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Obsidian Secret storage](https://docs.obsidian.md/Plugins/Guides/Store%20secrets)
- [Basecamp rich-text HTML and attachments](https://github.com/basecamp/bc-api/blob/master/sections/rich_text.md)
- [Basecamp authentication](https://github.com/basecamp/bc-api/blob/master/sections/authentication.md)
- [Official SDK and document update semantics](https://github.com/basecamp/basecamp-sdk/tree/main/typescript)
