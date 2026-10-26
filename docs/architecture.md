# Architecture and protocol

[Back to the README](../README.md)

Team Canvas uses a React/TypeScript frontend with Excalidraw, a Quarkus/Kotlin backend, and PostgreSQL 17 for boards and uploaded images. Caddy serves the frontend and proxies API and WebSocket traffic.

## Responsibilities

- `BoardResource` adapts HTTP requests for board creation, joins, authorized asset downloads, and invitation management.
- `Accounts` provisions verified issuer/subject identities and tracks login revocation.
- `CanvasAccess` manages ownership, durable memberships, invitations, and independent sessions.
- `CanvasCatalog` returns authorized metadata pages and validates owner renames.
- `BoardStore` applies scene permissions and storage quotas. `SceneRepository` owns scene SQL and accepts the current transaction connection.
- `RoundService` and `RoundRules` manage capability-protected private contributions and publication; there is no participant roster or readiness gate.
- `BoardRepository` handles transactions, row locks, and command receipts.
- `RoomHub` coordinates board operations and authorized delivery; `BoardSocket` adapts WebSocket callbacks. `SocketCommandCodec` decodes mutations and `ServerEvents` defines outgoing wire types.
- `AccessPolicy`, `RequestLimits`, and `SingleWriterGuard` enforce identity, allowed origins, resource budgets, and exclusive backend ownership.
- `syncSession.ts` maintains authoritative state, pending edits, acknowledgements, retries, and draft recovery.
- `useBoardSession.ts` connects that state to React, WebSockets, asset loading, and the editor.

Kotlin production and test sources use the package `dev.teamcanvas`. Database migrations live in `backend/src/main/resources/db/migration/` and run through Flyway.

## Synchronization and privacy

Changes use object-level last-writer-wins reconciliation. Accepted changes are echoed to their sender as well as authorized peers, and server revisions provide ordering. Concurrent edits to the same object can overwrite each other. CRDTs and revision history are not implemented.

Every scene mutation carries its round context. The backend rejects stale commands instead of interpreting a private contribution as a public edit. Command receipts let clients retry a command without applying it twice. Readiness updates do not replace the scene; this preserves edits still waiting for acknowledgement.

Page selection is shared by all connected viewers and increments the epoch when it changes. Page creation can copy current public content, optionally including published poker drawings. `PageCopy` assigns fresh element, group, and image IDs and remaps relationships between copied objects. Templates copy shared content across all pages into a new independent canvas.

Realtime commands and HTTP operations that notify peers acquire the in-memory board stripe before entering database transactions. Within a command transaction, the board row is locked before active membership/session rows are checked. Services pass the same connection to scene persistence; repository methods do not start nested transactions. Ordered notifications are enqueued only after the mutation commits, while the board stripe is still held.

Poker has no participant roster or readiness. Any active member starts or stops it. Private rows refer to round-scoped capability hashes, never participant identities. Clients authorize a capability after the initial snapshot; each image request requires both membership and that capability. Reveal is a single transaction that publishes saved live content and removes private associations. Late private writes fail stale context and remain recoverable locally.

The backend assumes a single active instance. PostgreSQL row locks serialize board commands, and a dedicated PostgreSQL session holds an advisory lock to reject a second backend. Direct connections or session pooling are required; transaction-mode PgBouncer is unsupported. Restart the backend after losing the ownership connection.

## Access and identity

Keycloak sign-in is required in every environment. Quarkus validates OIDC tokens and manages HttpOnly encrypted session cookies. The application accepts only JWT principals with issuer, subject, an unexpired ID token, and Keycloak `sid`. Local accounts are unique by `(issuer, subject)`; display names come from verified claims.

Each canvas has an owning account and a durable participant membership per user. Membership IDs remain the same across devices, tabs, logout, and token expiry. The role used for WebSocket commands is derived from the owning account. Legacy guest rows are retained but not claimed or listed.

Board-session tokens are random, hashed in PostgreSQL, expire after 24 hours, and bind the participant to a particular user and Keycloak login `sid`. Each open gets an independent token. Logout revokes that login's ledger entry and board sessions and closes its sockets before RP-initiated Keycloak logout; a different device login remains valid. Database commands recheck membership, board-session expiry, and login revocation under locks. Replayed cookies cannot resurrect a revoked login.

Only owners can create or revoke invitations. Each new link stores a separate hashed secret. Preview and explicit acceptance require both a signed-in account and the secret. Acceptance atomically adds a membership. Revoked memberships cannot rejoin through any invitation; the owner must explicitly restore them. Restoring membership never revalidates revoked session tokens. Invites grant editing membership, never ownership; every active member can start poker or reveal saved contributions.

Owner-only membership responses include a stable account ID, the verified SSO username when available, and account status. Profile names remain non-unique labels. Access history records the actor, target, action and timestamp for member access changes, invitation revocation, template publication and storage cleanup. It contains no drawing content, draft capabilities or session tokens, and is deleted with the canvas. Deleted accounts are detached from retained history.

Public templates can be copied by every active signed-in account, including revoked members. The sharing dialog exposes this independent publication channel and lets owners make the template private. Existing copies cannot be recalled. Templates are live sources, not versioned publications.

The dashboard returns only metadata scoped to active membership, with bounded cursor pagination and a user/filter-bound cursor. It never creates sockets or returns scene/private-round data. Names are broadcast as a `metadata` event serialized with other board events; this does not replace editor state.

React Router owns dashboard, invitation, editor, and logout navigation. The editor is loaded lazily. Route changes guard pending commands and unexported recovery drafts. Old sockets must finish closing before the next connection opens; asset requests and timers are cancelled on unmount. A tab uses no persistent bearer-token storage. Expired OIDC connections use the same `login_expired` close reason whether detected by a command or the sweeper, refresh the company session once, and reconnect with pending command IDs preserved. Membership revocation never triggers an automatic rejoin.

HTTP request origin and rate checks run before account provisioning. Account reads recheck identity blocks and login/account status, but unchanged profiles and existing login ledgers are read without rewriting the account. The request filter does not repeat service-level account provisioning.

## Protocol

Connect to `/ws/boards/{boardId}` and send `hello` with the board token. OIDC and allowed-origin checks also apply to the WebSocket upgrade.

Mutating commands contain a UUID `commandId`, the board `epoch`, a UUID `roundId` or `null`, and the current UUID `pageId`. The server stores command receipts for at least two days; participant tokens are valid for at most one day.

| Command | Behavior |
| --- | --- |
| `patch` with `elements` and `files` | Up to 100 elements and one new image; the server decides ownership and visibility |
| `start_round` | Any member starts private contributions and increments the epoch |
| `stop_round` | Any member publishes all saved private contributions |
| `draft` with round ID and capability | Authorizes this tab to recover its private draft |
| `create_page` with `copyCurrent` and `includePoker` | Creates and selects a page; unavailable during poker |
| `select_page` with `targetPageId` | Selects an existing page for all viewers; unavailable during poker |
| `resync` | Sends an authorized snapshot, limited to once every two seconds |
| `cursor` / `ping` | Sends transient position in standard mode or checks the connection |

Server events are `snapshot`, `patch`, `ack`, `round`, `metadata`, `presence`, `cursor`, `pong`, and `error`. The shared types live in [`protocol.ts`](../frontend/src/protocol.ts); [`protocolCodec.ts`](../frontend/src/protocolCodec.ts) validates incoming events.

Snapshots include image IDs, not image bytes. Assets are fetched individually through `GET /api/boards/{id}/assets/{assetId}` using `X-Board-Token` and the OIDC session. Asset responses use `Cache-Control: private, no-store`.

## Resource limits

| Resource | Limit |
| --- | --- |
| Open sockets | 200 total, 20 per company identity, 30 authenticated connections per canvas by default (configurable from 1 to 200 with `TEAM_CANVAS_MAX_CONNECTIONS_PER_CANVAS`) |
| Initial socket authentication | 10 seconds |
| Input bytes | 8 MB per connection and 64 MB globally per 10 seconds |
| Socket messages | 60 per second; up to 20 mutating commands per second |
| Persisted commands | 50,000 per canvas per day |
| Stored participants | 200 per board |
| Board contents | 4,000 elements, 150 images, 4 MB scene JSON, 32 MB image JSON |
| Outgoing queue | 64 messages or 8 MB per connection; slow readers are disconnected |
| Images | PNG, JPEG, WebP, or GIF; 1 MB per file; at most 8,192 pixels per dimension and 16 megapixels |

For GIFs, the pixel budget covers the combined frame/canvas dimensions, with at most 100 frames. Animated PNG and WebP are rejected. Image signatures and metadata are checked before storage. SVG, embedded web content, and element links are not accepted.

Presence reports both distinct people and occupied connections. A single person may occupy multiple connection slots through separate tabs.

Deleted elements remain as synchronization tombstones until the owner chooses **Canvas actions → Storage → Clean up storage**. Cleanup is available outside poker and atomically removes deleted elements and unused images across all pages, advances the epoch/revision, and publishes fresh snapshots under the room lock. Old commands fail their epoch check and unconfirmed client edits remain available for draft export. Editor undo history is reset at epoch transitions. Cleanup cannot inspect or reveal private poker drafts. Per-page limits are 4,000 stored elements, 150 images, 4 MB scene JSON and 32 MB image JSON; the whole canvas also has 20 MB scene and 128 MB image budgets.

## Operations

Boards are not automatically deleted. Define retention, storage monitoring, backups, and restore procedures before routine use.

Internal endpoints:

- `/q/health/started`, `/q/health/live`, and `/q/health/ready` provide startup, liveness, and readiness checks.
- `/q/metrics` provides HTTP/process metrics and application connection, command, and rejection metrics without participant or board labels.
- Application metric names use `team.canvas.*`, exposed as `team_canvas_*` in Prometheus.

Database ownership loss makes the backend unready and rejects commands. Logs avoid tokens and drawing contents. See the [deployment guide](../deploy/kubernetes/README.md) for cluster configuration and monitoring requirements.

## Identity provider and development proxy

Compose persists the development realm in `keycloakdata` and exposes Keycloak directly on its own public URL and host port. Browser authorization and end-session endpoints use `KEYCLOAK_PUBLIC_URL`; the OIDC issuer uses the same URL, while token/JWKS endpoints use the internal service address with discovery disabled only in Compose. The app callback and post-logout URLs use `PUBLIC_ORIGIN`. Production uses discovery against company Keycloak, TLS, secure cookies, and an encrypted session/state secret. There is no supported authentication bypass.

See [Keycloak realm import](https://www.keycloak.org/server/importExport), [hostname configuration](https://www.keycloak.org/server/hostname), and [Quarkus OIDC configuration](https://quarkus.io/guides/security-oidc-expanded-configuration/) for the upstream configuration contracts.

## Product scope and design principles

The core product is deliberately small:

- **Multi-page canvases:** organize a session across pages, starting blank or copying an existing page.
- **Poker mode:** collect private drawings and ideas, then let any member publish the saved contributions together. This is a contribution-and-reveal workflow, not a numeric estimation system.
- **Saved and shared work:** persist acknowledged changes automatically and reopen canvases through an account dashboard; invite colleagues through authenticated sharing links.
- **Reusable templates:** prepare layouts for Scrum sessions, retrospectives, or architecture discussions and start independent canvases from them.
- **Required company SSO and privacy:** authenticate every participant and enforce ownership, membership, and private-draft visibility on the server.

Easy company rollout and maintenance are design goals. Prefer a small number of services, established dependencies, explicit permissions, and changes that are easy to review. A new dependency must justify its maintenance cost; fewer dependencies must not mean reimplementing authentication or a drawing editor. Security fixes, reliable saving, safe upgrades, backup/restore, and clear operating instructions are part of the core scope.

Keep additions tied to those workflows. Chat, video calls, AI assistants, task/project management, plugin marketplaces, complex approval workflows, and a general integration platform are outside the intended scope. Existing search, tags, and presence support finding and using canvases; they should stay lightweight.

React/TypeScript and Excalidraw provide the browser UI; Kotlin/Quarkus provides one backend; PostgreSQL stores accounts, drawings, and uploaded images. Caddy serves the UI and proxies requests. Company deployments use an existing Keycloak identity provider. No Redis, message broker, separate image store, or application SaaS account is required. Tailwind and Vite are build tooling, and the UI is English.
