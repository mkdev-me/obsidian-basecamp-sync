# Changelog

## 0.1.6

- Prepare the first public release with account, network and hosted-service disclosures.
- Add an example selection screenshot and simplify public installation instructions.
- Document desktop and iOS use and the initial sign-in required on each device.
- Keep the sync behavior from 0.1.5 unchanged.

## 0.1.5

- Remove the automatic Open in Obsidian and Basecamp folder footer links entirely, without adding hidden sync markers.
- Remove old footers on the next sync of selected linked notes, even when the note text is unchanged, while retaining remote-edit conflict checks.
- Pause uncertain first uploads until the user reconciles and links the existing document instead of searching for a marker in published content.

## 0.1.4

- Explain the difference between Source folder and Include directly in settings, with an Obsidian-to-Basecamp folder mapping example.
- Clarify full vault paths, recursive folder selection, exclusions, and both Preserve folders options.
- Explain that Preview selection checks note destinations before publishing and linked documents stay in their current Basecamp location.

## 0.1.3

- Add a Source folder setting to map a vault subtree directly into the chosen Basecamp destination without copying its ancestor folders.
- Keep include/exclude patterns vault-relative and restrict synchronization to the chosen source folder.
- Show destination paths for new notes in Preview selection. Existing linked documents keep their Basecamp location.
- Reuse existing matching Basecamp folders and preserve the previous behavior when Source folder is empty.

## 0.1.2

- Fill in the shared mkdev login service URL automatically, including empty URLs saved by earlier versions.
- Preserve custom service URLs and restore the mkdev default when the field is cleared.
- Remove the outdated shared-service deployment warning and update setup instructions.

## 0.1.1

- Coalesce repeated login callbacks so each authorization code is exchanged once per pending login.
- Use the deployed stateless mkdev login service; remove the duplicate Node server implementation.
- Document the live shared integration and how to enter its service URL during beta testing.
- Development pre-release: real desktop/iOS login, renewal and Basecamp publication acceptance remain pending. The built-in shared service URL remains blank.

## 0.1.0

- Initial one-way sync from selected Obsidian notes to Basecamp documents.
- Configurable inclusion/exclusion, folder preservation, local attachments, previews and optional sync after edits.
- Durable document identities, change detection, remote conflict checks and interrupted-create recovery.
- Official Basecamp SDK with mobile-safe native transport.
- Shared OAuth service, personal integrations and existing bearer-token support.
- Install and update through BRAT on desktop and mobile, including private repository setup instructions.
- Development release: shared mkdev service deployment and live device acceptance remain release prerequisites.
