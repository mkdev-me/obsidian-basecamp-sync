# Third-party license sources

`basecamp-sdk-LICENSE` is the MIT license from [Basecamp SDK v0.16.0](https://github.com/basecamp/basecamp-sdk/blob/1bb0ae61d62abdc7aff5f7302148d39d69030066/LICENSE). The npm tarball does not include that file, so it is retained here for offline, reproducible builds.

The build reads all other bundled packages' license files from their installed npm packages, generates `THIRD_PARTY_NOTICES.txt`, and embeds the notices in `main.js`. This preserves required notices when Obsidian downloads only its three plugin assets.
