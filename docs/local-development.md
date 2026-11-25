# Local development and checks

[Back to the README](../README.md) · [User guide](user-guide.md)

Run the commands below from the repository root unless stated otherwise. The bundled Compose stack is for disposable development and test data. For retained company data, start with the [operator handover](operator-handover.md).

## Start the local stack

Install Docker with the Compose plugin. The bundled Compose setup is for development. Migration validation fails safely without resetting the schema. Use the [operator handover](operator-handover.md) before admitting retained company data. From the repository root:

```sh
test -f .env || cp .env.example .env
openssl rand -hex 24
# Put the generated password into .env as DB_PASSWORD, then:
docker compose build
docker compose up -d --wait db keycloak
docker compose run --rm --no-deps backend migrate
docker compose up -d --wait --wait-timeout 300
```

For subsequent development starts, `docker compose up --build -d --wait --wait-timeout 300` also applies pending migrations automatically, validating existing migration checksums first. An incompatible migration history still stops startup; existing volumes are never reset. Company deployments continue to use the separate migration procedure in the operator handover.

Open **http://localhost:8088** and choose **Login with SSO**. The browser signs in through the separate development Keycloak URL at **http://localhost:8180/auth**. Compose includes a development realm with these example accounts:

| Username | Default development password |
| --- | --- |
| `alice` | `alice-dev-only` |
| `bob` | `bob-dev-only` |

Use separate browser profiles, private windows, or devices to test the two accounts. Create a canvas, choose **Share → Create invitation link**, and open that link in the other browser. After sign-in, choose **Accept invitation**. The canvas then appears in that user’s dashboard.

Configure passwords through `DEV_ALICE_PASSWORD` and `DEV_BOB_PASSWORD` before the first start. The development admin console is at **http://localhost:8180/auth/admin/**, with `dev-admin` and `DEV_ADMIN_PASSWORD` (default `admin-dev-only`). Configure the public Keycloak address with `KEYCLOAK_PUBLIC_URL` and its host port/bind address with `KEYCLOAK_HTTP_PORT` and `KEYCLOAK_BIND`. These accounts and the bundled development identity provider are **not a company deployment configuration**.

Application data persists in `pgdata`; Keycloak data persists in `keycloakdata`. `docker compose down` retains both. **`docker compose down -v` deletes both volumes and all their data.** Passwords and realm settings are imported only on the first start. Editing `.env` does not update existing PostgreSQL or Keycloak passwords; update those through their administration tools.

## Try it on the same WLAN

Before the first start, set the following in `.env`, using the host computer’s actual WLAN IP:

```dotenv
HTTP_BIND=0.0.0.0
HTTP_PORT=8088
PUBLIC_ORIGIN=http://192.168.1.42:8088
KEYCLOAK_BIND=0.0.0.0
KEYCLOAK_HTTP_PORT=8180
KEYCLOAK_PUBLIC_URL=http://192.168.1.42:8180/auth
```

Set your own development account passwords, allow inbound TCP ports `8088` and `8180` on the private network, then follow [Start the local stack](#start-the-local-stack). **Everyone must use the exact `PUBLIC_ORIGIN` URL for Team Canvas and the exact `KEYCLOAK_PUBLIC_URL` host for Keycloak**, including the host. An invitation created at `localhost` cannot work on another person’s computer.

`PUBLIC_ORIGIN` configures the app callback, post-logout URL, and allowed request origin. `KEYCLOAK_PUBLIC_URL` configures Keycloak’s browser URL and OIDC issuer. Backend token/JWKS calls use the internal Compose service address; browser redirects never use that address. Do not add trailing slashes to either setting.

If Keycloak was already initialized, update the `team-canvas` client in its admin console when the app origin changes: **Valid redirect URIs** to `<PUBLIC_ORIGIN>/api/login`, **Valid post logout redirect URIs** to `<PUBLIC_ORIGIN>/login`, and **Web origins** to `<PUBLIC_ORIGIN>`. Restart Compose after changing `.env`. The issuer is now based on `KEYCLOAK_PUBLIC_URL`; changing it creates a distinct account namespace. Existing database and Keycloak data are retained, but users may see an empty account until their identity is migrated. Keep the Keycloak URL stable once users have created canvases.

This development setup explicitly permits HTTP cookies and Keycloak HTTP sign-in. Use only on a trusted network without router port forwarding. Company deployments require HTTPS. If devices cannot connect, check the host firewall and WLAN client/guest isolation.

## Development and checks

Use JDK 21, Maven 3.9+, Node.js 24 with npm 11.19.1, and PostgreSQL 17. The full Compose stack is the simplest way to exercise the real sign-in flow. Frontend development against that stack:

```sh
npm ci --prefix frontend
TEAM_CANVAS_DEV_PROXY=http://localhost:8088 npm run dev --prefix frontend
```

Vite serves on `5173`. For authenticated Vite development, configure the development Keycloak client’s exact callback/post-logout URLs for `http://localhost:5173`, set `PUBLIC_ORIGIN=http://localhost:5173`, and restart the backend. Keycloak remains directly available at `KEYCLOAK_PUBLIC_URL`; Vite proxies only `/api` and `/ws` to the Compose frontend at `8088`. Do not run two backends against the same database.

For a host-run backend, export `DB_USER`, `DB_PASSWORD`, `JDBC_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and a client/session secret, then run `mvn quarkus:dev` from `backend/`. Maven does not load `.env`. Its issuer and OIDC endpoints must be reachable from the host. See the [OIDC configuration reference](https://quarkus.io/guides/security-oidc-expanded-configuration/).

```sh
npm run test:sync --prefix frontend
npm run build --prefix frontend
(cd backend && mvn test)

# Isolated test schema in a disposable PostgreSQL database:
(cd backend && TEAM_CANVAS_TEST_JDBC_URL=jdbc:postgresql://localhost:5432/board mvn test)

# A separate disposable stack, with its own ports and data volumes:
HTTP_PORT=8089 DB_PORT=5433 KEYCLOAK_HTTP_PORT=8181 \
  PUBLIC_ORIGIN=http://localhost:8089 KEYCLOAK_PUBLIC_URL=http://localhost:8181/auth \
  docker compose -p team-canvas-e2e up --build -d --wait --wait-timeout 300
node frontend/node_modules/playwright/cli.js install chromium
BASE_URL=http://localhost:8089 node tests/smoke.mjs
BASE_URL=http://localhost:8089 npm run test:e2e --prefix frontend
# Discard only the isolated test stack and its data:
docker compose -p team-canvas-e2e down -v
```

Export the test database credentials and any changed `DEV_ALICE_PASSWORD`/`DEV_BOB_PASSWORD` before running tests. Browser and smoke tests require an explicit `BASE_URL` and refuse to default to the working app. They create canvases and exercise both demo accounts, so point them only at a disposable test deployment and discard its volumes afterward. Screenshots and failure traces go to ignored `test-results/`; traces may contain session data and must be treated as sensitive.

CI runs frontend checks, backend tests with PostgreSQL, container builds, authenticated protocol/browser journeys, and vulnerability scans. WLAN routing and company identity/ingress settings still need validation in their target environment.

## AI chat and external assistants

Start with the README's [chat setup and examples](../README.md#work-with-the-canvas-through-chat) for OpenAI, Open WebUI, other OpenAI-compatible providers, Codex, OpenCode V2, and Claude Code. This section covers deployment details and troubleshooting.

The embedded chat uses an OpenAI-compatible Chat Completions endpoint with function tools. Set these backend variables in the existing `.env`, preserving other settings:

```dotenv
TEAM_CANVAS_AI_BASE_URL=https://your-provider.example/v1
TEAM_CANVAS_AI_MODEL=your-tool-capable-model
TEAM_CANVAS_AI_API_KEY=your-provider-key
PUBLIC_ORIGIN=http://localhost:8088
```

For Compose, run `docker compose up -d --build backend frontend` to build the feature and recreate services with the configuration. A plain `docker compose restart` does not load changed environment variables. For a host-run backend, export the variables and restart Quarkus; Maven does not load `.env`.

The base URL excludes `/chat/completions`. The API key is optional for local providers. Keep credentials in `.env` or your secret manager. The model must support function calls and tool-result messages. With no endpoint and model, chat explicitly reports that it is unconfigured; the MCP tools and proposal review still work. External assistants use their own model service. The application does not enable a fake model as a fallback.

For **Open WebUI**, use `TEAM_CANVAS_AI_BASE_URL=https://your-webui.example/api`, an Open WebUI API key in `TEAM_CANVAS_AI_API_KEY`, and a model ID from that account's `GET /api/models` results in `TEAM_CANVAS_AI_MODEL`. This produces requests to `/api/chat/completions` using bearer authentication. Configure native function calling on the model; Team Canvas executes its own canvas tools. See the [Open WebUI API reference](https://docs.openwebui.com/reference/api-endpoints/). With Compose, use a provider address reachable from the backend container; a host-local service is not reachable at the container's `localhost`.

The MCP endpoint is `<PUBLIC_ORIGIN>/mcp`, using stateless Streamable HTTP with protocol versions `2025-03-26`, `2025-06-18`, and `2025-11-25`. OAuth discovery is served at `/.well-known/oauth-protected-resource/mcp`. The MCP service tenant validates bearer-token issuer, expiry, and the exact resource audience `<PUBLIC_ORIGIN>/mcp`; browser API authentication remains separate. Tokens require `canvas:read`, with `canvas:propose` additionally required to submit proposals. Membership and account status are checked for tool access. Private poker drafts are excluded.

New development realms include the public Keycloak client `team-canvas-mcp` with PKCE S256, loopback callbacks, and the MCP resource audience. **Existing Keycloak realms are not updated by `--import-realm`.** Follow [existing-realm setup](#add-mcp-access-to-an-existing-development-realm), retaining the existing browser client and user data. Production administrators should register approved assistant clients and callback URIs with the company IdP, preserve the `sub`, `sid`, and profile claims, and issue the exact MCP audience.

For current Codex clients:

```sh
codex mcp add team_canvas --url https://your-canvas.example/mcp --oauth-client-id team-canvas-mcp
codex mcp login team_canvas --scopes canvas:read,canvas:propose
```

For OpenCode V2, use the [complete configuration example](../README.md#opencode): servers belong under `mcp.servers`, OAuth uses `client_id`, and `/mcps` opens authentication. Replace the local URL with your deployment URL. V1 uses `mcp.<server-name>` and `clientId`; configuration layout varies between releases, so use the installed client's schema.

For current Claude Code clients supporting pre-registered OAuth credentials:

```sh
claude mcp add --transport http --client-id team-canvas-mcp team_canvas https://your-canvas.example/mcp
# In Claude Code, open /mcp and authenticate.
```

Check `claude mcp add --help` for `--client-id`; older releases need an upgrade or the bearer-token mode below. The bundled public client has no secret.

Clients can also send an OAuth-issued access token in the `Authorization: Bearer` header, using environment substitution in their configuration. Tokens expire; use the client's OAuth flow for automatic refresh rather than committing tokens. Older clients that lack pre-registered OAuth configuration need this header-based mode or an upgrade.

The tools list accessible canvases/pages, inspect objects and exact counts, read text, traverse connected notes, and create/list change proposals. Newly created objects can have local IDs in a proposal so its connections reference them. `update_text` references an inspected object ID. Proposals carry page/round context, and application uses one idempotent synchronization command. Clients should inspect before proposing changes and include the returned `epoch` and `revision` when provided by the tool schema.

For repeatable integration tests, run `node tests/fixtures/assistant-provider.mjs` on the same host as an isolated backend and configure that backend with `TEAM_CANVAS_AI_BASE_URL=http://localhost:18182/v1` and `TEAM_CANVAS_AI_MODEL=assistant-test-fixture`. Set `ASSISTANT_TEST_PROVIDER=fixture` when running `assistant.spec.mjs`. Its default test issuer is `http://localhost:18181/auth/realms/team-canvas`; override it with `ASSISTANT_TEST_ISSUER`. The tests cover browser chat, cross-session saves, OAuth/PKCE, durable proposals, and actual installed MCP clients without model inference. The fixture is for tests only. Use a separate database for backend integration tests because writer-lock checks require no running backend in that database.

Production proxies must route `/mcp` and `/.well-known/oauth-protected-resource/*` to the backend. Set `PUBLIC_ORIGIN` to the public HTTPS origin. In Helm deployments, add explicit provider CIDRs and ports to `assistant.egress` and provision the AI variables in `existingSecret`; the default egress policy otherwise permits only the database, identity provider, and DNS.

### Add MCP access to an existing development realm

For the bundled Compose development stack, run this once from the repository root with Node.js 22+ and Docker access:

```sh
node deploy/keycloak/configure-mcp.mjs
```

The helper uses Keycloak's Admin CLI and the running container's bootstrap admin credentials. It adds or updates only the development MCP client, its audience mapper, and required scopes; it preserves existing users, the browser client, and canvas data. It can be rerun, uses the running Keycloak `PUBLIC_ORIGIN` for the audience, and removes its temporary admin credential file afterward. If the admin password has changed since initial setup, use the manual procedure below with your current admin account.

For manual setup:

Use the development Keycloak admin console at **http://localhost:8180/auth/admin/** and select the existing `team-canvas` realm. Match the definitions in [team-canvas-realm.json](../deploy/keycloak/team-canvas-realm.json); replace `${PUBLIC_ORIGIN}` with the app's actual origin. Do not delete or recreate the realm.

1. Under **Client scopes**, create the OpenID Connect scopes `canvas:read` and `canvas:propose`. Enable **Include in token scope** for both.
2. Under **Clients**, create the OpenID Connect client `team-canvas-mcp`. Turn **Client authentication** off (public client), enable **Standard flow**, and leave direct access grants and service accounts disabled.
3. Set **Valid redirect URIs** to `http://127.0.0.1/*` and `http://localhost/*` for this development client. Set **Proof Key for Code Exchange Code Challenge Method** to `S256` in its advanced settings. Company deployments should register approved callback URIs instead.
4. Assign `basic`, `profile`, `email`, `canvas:read`, and `canvas:propose` as the client's **Default** scopes. Preserve the realm's existing subject, session, and profile mappers.
5. In the client's dedicated scope, add an **Audience** mapper named `team-canvas-mcp-audience`. Set **Included Custom Audience** to the exact MCP URL, normally `http://localhost:8088/mcp`, enable **Add to access token**, and disable **Add to ID token**. Leave **Included Client Audience** unset.
6. Verify `.env` has the matching `PUBLIC_ORIGIN`, recreate the backend if that setting changed, and authenticate the assistant again. Update the audience mapper whenever the app origin changes.

### MCP connection troubleshooting

| Symptom | Check |
| --- | --- |
| `/mcp` returns 404 | Build and recreate the backend/frontend. Ensure the reverse proxy forwards `/mcp` and `/.well-known/oauth-protected-resource/*`. |
| `/mcp` returns 401 before login | Authentication is required. Use the assistant's MCP OAuth login; an OpenAI API key is not a canvas access token. |
| `invalid_client` or dynamic registration fails | Register `team-canvas-mcp` in the existing realm and configure the assistant's pre-registered client ID. |
| Redirect URI mismatch | Match the assistant's loopback callback with the registered client URIs; check both `localhost` and `127.0.0.1`. |
| Token rejected or wrong audience | Match `PUBLIC_ORIGIN`, the MCP URL, and the access-token audience exactly, including scheme and port. Verify the issuer, then sign in again. |
| Missing `canvas:read` or `canvas:propose` | Assign the scopes to the client, include them in token scope, request the needed scopes, and authenticate again. |
| No canvases or access denied | Sign in with the account that owns or joined the canvas; inactive accounts and removed members cannot access it. |
| Unknown OAuth CLI flag or OpenCode config error | Upgrade the client or use its version's schema. OpenCode V1 and V2 layouts differ; older Claude Code lacks `--client-id`. |
| Proposal not visible | Open the relevant canvas and page, then its assistant; allow a few seconds for refresh. Check expiry and whether the page or round changed. |
| Embedded chat is unconfigured | Configure the backend provider variables and recreate the service. External MCP access and proposal review work independently. |
| Open WebUI returns 401/403 | Enable API keys and the account's API permissions in Open WebUI, use its key rather than an OpenAI key, and verify that account can access the selected model. |
| Provider returns 404 | Check the API root: OpenAI normally uses `/v1`, Open WebUI `/api`. The app appends `/chat/completions`. |
| Provider times out in Compose | The provider must be reachable from the backend container; its `localhost` is not the Docker host. Check DNS, routing, and provider bind address. |
| The model answers but cannot propose changes | Use a model with native function calling and tool-result support; for Open WebUI, check the model's function-calling configuration. |
| A remote assistant cannot reach localhost | Use an app and identity-provider URL reachable from that assistant's host. `localhost` refers to the assistant's machine. |

## Troubleshooting

```sh
docker compose config --quiet
docker compose ps -a
docker compose logs --tail=100 backend db frontend keycloak
```

| Symptom | Check |
| --- | --- |
| Docker socket permission denied | Ensure your user can access the Docker daemon. |
| `Set DB_PASSWORD in .env` | Create `.env` and set the database password. |
| Address already in use | Change the port and keep `PUBLIC_ORIGIN` consistent. |
| Login redirect or issuer mismatch | Keep the app callback URLs aligned with `PUBLIC_ORIGIN`, the OIDC issuer aligned with `KEYCLOAK_PUBLIC_URL`, and saved Keycloak client URLs aligned with the app origin. |
| Password changes do not take effect | Existing database/realm state is retained; update credentials administratively. |
| Another backend owns the database | Stop that backend before starting this one. |
| Access expired or revoked | Export unsaved work if needed, then rejoin/sign in. Membership survives ordinary session expiry; removed members must have access restored by the canvas owner, even if they have a new invitation. |
| Build downloads fail | Check DNS, network access, and build proxy settings. |

## Connection limit

The default is 30 simultaneous connections per canvas, including multiple tabs. Set `TEAM_CANVAS_MAX_CONNECTIONS_PER_CANVAS` in `.env` to an integer from 1 to 200, then recreate the backend with `docker compose up -d`. This deployment-wide setting applies to every canvas; the server-wide limit remains 200 connections and each account can open at most 20. Run only one backend per database.
