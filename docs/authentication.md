# Authentication and the mkdev integration

## What is available today

The official [SDK authentication guide](https://github.com/basecamp/basecamp-sdk/tree/main/typescript#getting-a-token) describes a device grant that needs no new app registration. During development on **2026-09-07**, the public [resource discovery endpoint](https://3.basecampapi.com/.well-known/oauth-protected-resource) advertised only Launchpad, whose [authorization metadata](https://launchpad.37signals.com/.well-known/oauth-authorization-server) advertised authorization-code and refresh-token grants, with no device endpoint or S256 support. Accordingly, this release implements the documented Launchpad flow rather than relying on an unavailable public device flow.

Basecamp's API and SDK documentation currently disagree about personal access tokens. The plugin accepts an existing bearer token if you already have one, but does not claim a universally available personal-token creation workflow.

Ordinary users do **not** need their own OAuth app once mkdev has registered and deployed the shared integration. Before that service exists, use a personal integration or an existing token. The default service URL is intentionally blank until a real service has been verified.

## Maintainer: prepare the shared mkdev integration

1. Choose an HTTPS origin for the login service, for example a subdomain you control. The example domains in this repository are placeholders.
2. Register **Basecamp Sync by mkdev** at [Launchpad integrations](https://launchpad.37signals.com/integrations).
3. Set the exact redirect URI to `https://YOUR-LOGIN-HOST/callback`.
4. Record the client ID and client secret in your deployment's secret manager. Never commit the secret, put it in Obsidian's manifest or embed it in `main.js`.
5. Install production dependencies, configure the environment and start the included service:

   ```sh
   npm ci --omit=dev
   node --env-file=broker/.env broker/server.mjs
   ```

   Start from `broker/.env.example`. Set `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET` and `PUBLIC_URL` to your real values. `PUBLIC_URL` must be a bare HTTPS origin with no path. The service binds to loopback on port 8787 by default; `HOST` and `PORT` can be set by the deployment.

6. Put an HTTPS reverse proxy in front of it. Set a 16 KB request-body limit, per-client rate limits and sensible request timeouts. Disable access logs or redact the query string for `/callback`; never log request bodies or authorization values. Do not cache any endpoint.
7. Use a **single process/replica**. Login handshakes live in a bounded in-memory store for ten minutes, and redeemed token tickets live for at most five minutes. A restart cancels unfinished logins. Completed logins retain their refresh token on the user's device, so a service restart does not invalidate those sessions.
8. Check `/health`, then perform the desktop and physical iOS login, token-refresh and reconnection tests in [releasing.md](releasing.md).
9. Set `DEFAULT_BROKER_URL` in `src/model.ts` to that verified origin and rebuild the plugin. The URL is public, not a secret. Users may override it to use their own deployment.

The service is ready to deploy, but no hosting resource, domain, OAuth registration or live deployment is created by this repository.

## How shared login works

1. Obsidian generates a random state and a PKCE verifier/challenge, saving pending state in device-local Secret storage.
2. The service creates its own independent OAuth state, remembers the challenge and returns the Launchpad authorization URL.
3. The user approves access in Basecamp. Launchpad returns to the service, which validates its state and exchanges the code using mkdev's client secret.
4. The service redirects to `obsidian://basecamp-sync` with an opaque ticket and the plugin's state. **No access token or refresh token enters the deep link.**
5. The original device presents the ticket and verifier over HTTPS. Only the matching verifier can redeem the ticket, once, for the tokens.
6. Obsidian talks directly to Basecamp for notes, folders and attachments. Only token refresh passes through the service, keeping the shared client secret server-side.

The challenge protects the service-to-Obsidian handoff. This is not a claim that Launchpad itself implements PKCE. The service must be trusted with authorization codes and tokens during login and refresh. It does not receive note text or attachment bodies, persist tokens to disk, or log them. Operators must apply the same policy at their proxy and hosting layers.

## User: use the shared integration

Choose **Shared mkdev integration**, retain the published default URL (or enter your administrator's deployed service URL), and click **Connect to Basecamp**. Approve access and return to Obsidian. Load your accounts and projects in the settings.

If the browser does not open Obsidian, copy the full callback/deep-link URL into **Complete login manually**. Pending logins expire after ten minutes; restart the connection if necessary. The callback must complete in the same vault and on the same device that started it.

## User: use your own integration

1. Register your own integration at [Launchpad integrations](https://launchpad.37signals.com/integrations).
2. Use `obsidian://basecamp-sync` as the redirect URI if the integration form accepts custom URI schemes. If it requires HTTPS, host the supplied [callback.html](../broker/callback.html) at an HTTPS URL you control and register that exact URL instead. This is a static page; it needs no server secret. Configure its host to avoid recording OAuth codes in URL/query logs.
3. Select **My own integration** in the plugin settings.
4. Enter the client ID. Use the **Client secret** control to create/select a secret in Obsidian Secret storage. Enter exactly the registered redirect URI.
5. Click **Connect to Basecamp**, approve access, and return to Obsidian. The static page offers a return link and the plugin also accepts a pasted full callback URL.

This direct mode stores **your own** integration secret on your device so the SDK can exchange and refresh tokens. Do not use it to distribute mkdev's shared secret. Organizations that want their secret to remain on a server should deploy the included service with their own credentials and select the shared-service mode with that service's URL.

Set up the client-secret entry and connect independently on every device. Changing a login method or integration calls for a new connection. Existing sessions retain their original service/credential reference for refresh; changing the visible service URL never silently forwards an existing refresh token elsewhere.

## User: existing access token

Choose **Existing access token** and create/select a bearer token in Secret storage. The token must grant write access. This mode does not need an OAuth registration in the plugin, but it cannot create or renew a token for you. Replace an expired token or switch to an OAuth login mode.

## Disconnect and revoke

**Disconnect** clears this plugin's OAuth session and pending login from this device and clears its in-memory HTTP cache. It does not revoke Basecamp authorization or delete separately named secrets selected for the personal integration/token modes. Remove those entries in Obsidian Secret storage if desired. To revoke access, remove the integration authorization in your Basecamp/37signals account. Repeat device cleanup on other clients.
