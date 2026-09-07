# Privacy

Basecamp Sync sends selected note titles and rendered text, and optionally embedded local files, to the Basecamp account and project chosen by the user. Note paths and vault names are included in source links. Readers with access to those Basecamp documents can see the published content and links.

The plugin does not collect telemetry, contact analytics services, use AI services or execute embedded third-party note renderers. It makes no network request on load. Automatic publication is opt-in on each device and only runs for configured selections while Obsidian is open.

Network destinations are Basecamp's API, 37signals Launchpad for personal OAuth, and the configured login service for shared OAuth login/refresh. External links in a note are not fetched by the plugin. Opening a link yourself is handled by your browser or Obsidian.

In shared-service mode, the service processes OAuth codes and tokens during login and refresh. Note and attachment requests go directly from Obsidian to Basecamp. The supplied service stores only short-lived login handshakes and token tickets in memory and does not log credentials. The service operator is responsible for hosting-layer log retention and access controls.

Tokens, pending login state and private client secrets are kept in Obsidian Secret storage, which is local to this device and vault. Other installed plugins can access that shared storage; it is not isolation from untrusted plugins. Do not publish your vault's local application storage. Note properties and plugin `data.json` contain no raw login tokens, but they do contain destination IDs, paths, configuration and attachment references.

Disconnect clears this plugin's local OAuth session, pending login and HTTP cache. It does not delete Basecamp documents, revoke the integration remotely, or delete separately named secrets selected by the user. Revoke authorization in Basecamp/37signals to remove remote access. Disable or uninstall the plugin to stop further syncing.
