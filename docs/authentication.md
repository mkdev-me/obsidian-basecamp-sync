# Authentication and the mkdev integration

## What is available today

The official [SDK authentication guide](https://github.com/basecamp/basecamp-sdk/tree/main/typescript#getting-a-token) describes a device grant that needs no new app registration. During development on **2026-09-07**, the public [resource discovery endpoint](https://3.basecampapi.com/.well-known/oauth-protected-resource) advertised only Launchpad, whose [authorization metadata](https://launchpad.37signals.com/.well-known/oauth-authorization-server) advertised authorization-code and refresh-token grants, with no device endpoint or S256 support. Accordingly, this release implements the documented Launchpad flow rather than relying on an unavailable public device flow.

Basecamp's API and SDK documentation currently disagree about personal access tokens. The plugin accepts an existing bearer token if you already have one, but does not claim a universally available personal-token creation workflow.

Ordinary users do **not** need their own OAuth app. The mkdev integration was registered and deployed on 2026-09-07 at `https://basecamp-obsidian-sync.fodoj.com`. Its HTTPS health check and login-start routing pass. The plugin fills in this URL automatically, including when upgrading an installation with an empty saved URL. Custom service URLs are preserved. Live desktop login was verified, and the maintainer confirmed iOS syncing works after its initial sign-in on 2026-09-08. See [the release checklist](releasing.md) for the acceptance record.

## Maintainer: prepare the shared mkdev integration

The shared integration uses one stateless Cloudflare Worker in [fodoj-com](https://github.com/FJCorp/fodoj-com/tree/main/services/basecamp-obsidian-sync), a private infrastructure repository accessible to its maintainers. Its implementation is not included in this open-source plugin. The following deployment steps are for maintainers with access; ordinary users can use the hosted service or the **My own integration** instructions below.

1. The shared [Basecamp Sync by mkdev app](https://launchpad.37signals.com/integrations/28850) is registered with callback `https://basecamp-obsidian-sync.fodoj.com/callback`. Register a separate app at [Launchpad integrations](https://launchpad.37signals.com/integrations) for your own deployment.
2. Deploy the Worker using its README and set `BASECAMP_CLIENT_ID` and `BASECAMP_CLIENT_SECRET` as Cloudflare secrets. No database, migrations or scheduled jobs are needed. Never embed the app secret in the plugin.
3. Check `/health`, then perform the desktop and physical iOS login, renewal and reconnection checks in [releasing.md](releasing.md). Use a test account to verify Basecamp's authorization-code expiry and reuse behavior; repeated exchange may invalidate previously issued tokens.
4. `DEFAULT_BROKER_URL` points to `https://basecamp-obsidian-sync.fodoj.com`.

An organization with access to the Worker can deploy it with its own app credentials and HTTPS origin, then enter that address in the plugin. Other users can register their own integration and use the direct mode below; its static callback page is included in this public repository.

## How shared login works

1. Obsidian generates a random state and a PKCE verifier/challenge, saving pending state in device-local Secret storage.
2. The service encrypts the state, challenge and expiry into an OAuth state envelope and returns the Launchpad authorization URL.
3. The user approves access in Basecamp. Launchpad returns to the service, which validates the envelope and encrypts the authorization code into a short-lived ticket.
4. The service redirects to `obsidian://basecamp-sync` with that ticket and the plugin's state. **No raw authorization code, access token or refresh token enters the deep link.**
5. The original device presents the ticket and verifier over HTTPS. The Worker validates them, exchanges the code through the SDK using mkdev's secret, and returns tokens directly to Obsidian. Basecamp enforces code expiry and reuse; Obsidian coalesces concurrent callbacks and clears completed pending logins.
6. Obsidian talks directly to Basecamp for notes, folders and attachments. Only token refresh passes through the service, keeping the shared client secret server-side.

The challenge protects the service-to-Obsidian handoff; Launchpad does not currently advertise PKCE support. The Worker keeps no login database, token store or replay registry. Its short-lived envelopes survive restarts without server storage. The service and its hosting provider must be trusted with plaintext codes and tokens during requests. Note text and attachments go directly to Basecamp. Operators must avoid retaining codes or credentials in hosting-layer logs.

## User: use the shared integration

Choose **Shared mkdev integration** and click **Connect to Basecamp**. The **Login service URL** is filled in automatically. Approve access and return to Obsidian. Load your accounts and projects in the settings. For an organization-hosted integration, replace the URL with your administrator's service URL. Clearing it restores the mkdev default.

If the browser does not open Obsidian, copy the full callback/deep-link URL into **Complete login manually**. Pending logins expire after ten minutes; restart the connection if necessary. The callback must complete in the same vault and on the same device that started it.

Connect once on each device: vault sync carries your notes and plugin settings, but login credentials stay in that device's Secret storage. An initial sign-in on iOS after connecting on desktop is expected. The plugin refreshes OAuth tokens automatically; routine syncing should not require repeated sign-ins.

## User: use your own integration

1. Register your own integration at [Launchpad integrations](https://launchpad.37signals.com/integrations).
2. Use `obsidian://basecamp-sync` as the redirect URI if the integration form accepts custom URI schemes. If it requires HTTPS, host the supplied [callback.html](../broker/callback.html) at an HTTPS URL you control and register that exact URL instead. This is a static page; it needs no server secret. Configure its host to avoid recording OAuth codes in URL/query logs.
3. Select **My own integration** in the plugin settings.
4. Enter the client ID. Use the **Client secret** control to create/select a secret in Obsidian Secret storage. Enter exactly the registered redirect URI.
5. Click **Connect to Basecamp**, approve access, and return to Obsidian. The static page offers a return link and the plugin also accepts a pasted full callback URL.

This direct mode stores **your own** integration secret on your device so the SDK can exchange and refresh tokens without mkdev's hosted service. Do not use it to distribute mkdev's shared secret. An organization-operated compatible login service can keep its integration secret on a server; select the shared-service mode with its URL.

Set up the client-secret entry and connect independently on every device. Changing a login method or integration calls for a new connection. Existing sessions retain their original service/credential reference for refresh; changing the visible service URL never silently forwards an existing refresh token elsewhere.

## User: existing access token

Choose **Existing access token** and create/select a bearer token in Secret storage. The token must grant write access. This mode does not need an OAuth registration in the plugin, but it cannot create or renew a token for you. Replace an expired token or switch to an OAuth login mode.

## Disconnect and revoke

**Disconnect** clears this plugin's OAuth session and pending login from this device and clears its in-memory HTTP cache. It does not revoke Basecamp authorization or delete separately named secrets selected for the personal integration/token modes. Remove those entries in Obsidian Secret storage if desired. To revoke access, remove the integration authorization in your Basecamp/37signals account. Repeat device cleanup on other clients.
