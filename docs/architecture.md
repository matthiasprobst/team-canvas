# Architecture and protocol

[Back to the README](../README.md)

Team Canvas uses a React/TypeScript frontend with Excalidraw, a Quarkus/Kotlin backend, and PostgreSQL 17 for boards and uploaded images. Caddy serves the frontend and proxies API and WebSocket traffic.

## Responsibilities

- `BoardResource` adapts HTTP requests for board creation, joins, authorized asset downloads, and invitation management.
- `Accounts` provisions verified issuer/subject identities and tracks login revocation.
- `CanvasAccess` manages ownership, durable memberships, invitations, and independent sessions.
- `CanvasCatalog` returns authorized metadata pages and validates owner renames.
- `BoardStore` applies scene rules using parameterized database queries.
- `RoundService` and `RoundRules` manage the round roster, readiness, cancellation, and publication.
- `BoardRepository` handles transactions, row locks, persisted readiness, and command receipts.
- `RoomHub` and `BoardSocket` manage connections, presence, ordered output, and authorized delivery.
- `AccessPolicy`, `RequestLimits`, and `SingleWriterGuard` enforce identity, allowed origins, resource budgets, and exclusive backend ownership.
- `syncSession.ts` maintains authoritative state, pending edits, acknowledgements, retries, and draft recovery.
- `useBoardSession.ts` connects that state to React, WebSockets, asset loading, and the editor.

Kotlin production and test sources use the package `dev.teamcanvas`. Database migrations live in `backend/src/main/resources/db/migration/` and run through Flyway.

## Synchronization and privacy

Changes use object-level last-writer-wins reconciliation. Accepted changes are echoed to their sender as well as authorized peers, and server revisions provide ordering. Concurrent edits to the same object can overwrite each other. CRDTs and revision history are not implemented.

Every scene mutation carries its round context. The backend rejects stale commands instead of interpreting a private contribution as a public edit. Command receipts let clients retry a command without applying it twice. Readiness updates do not replace the scene; this preserves edits still waiting for acknowledgement.

A round stores its participant roster and readiness in PostgreSQL. The server publishes contributions in one transaction only after every roster member is ready. Private elements and image downloads are authorized on the server. Cancelling a round deletes its private data. Deleted private elements and unused private images are removed before publication.

The backend assumes a single active instance. PostgreSQL row locks serialize board commands, and a dedicated PostgreSQL session holds an advisory lock to reject a second backend. Direct connections or session pooling are required; transaction-mode PgBouncer is unsupported. Restart the backend after losing the ownership connection.

## Access and identity

Keycloak sign-in is required in every environment. Quarkus validates OIDC tokens and manages HttpOnly encrypted session cookies. The application accepts only JWT principals with issuer, subject, an unexpired ID token, and Keycloak `sid`. Local accounts are unique by `(issuer, subject)`; display names come from verified claims.

Each canvas has an owning account and a durable participant membership per user. Membership IDs remain the same across devices, tabs, logout, and token expiry. The role used for WebSocket commands is derived from the owning account. Legacy guest rows are retained but not claimed or listed.

Board-session tokens are random, hashed in PostgreSQL, expire after 24 hours, and bind the participant to a particular user and Keycloak login `sid`. Each open gets an independent token. Logout revokes that login's ledger entry and board sessions and closes its sockets before RP-initiated Keycloak logout; a different device login remains valid. Database commands recheck membership, board-session expiry, and login revocation under locks. Replayed cookies cannot resurrect a revoked login.

Only owners can create or revoke invitations. Each new link stores a separate hashed secret. Preview and explicit acceptance require both a signed-in account and the secret. Acceptance atomically adds or reactivates the existing membership. Invites grant member access, never ownership. Revocation can affect only links or also all shared memberships; it never edits the frozen poker roster.

The dashboard returns only metadata scoped to active membership, with bounded cursor pagination and a user/filter-bound cursor. It never creates sockets or returns scene/private-round data. Names are broadcast as a `metadata` event serialized with other board events; this does not replace editor state.

React Router owns dashboard, invitation, editor, and logout navigation. The editor is loaded lazily. Route changes guard pending commands, unexported drafts, and unfinished poker participation. Old sockets must finish closing before the next connection opens; asset requests and timers are cancelled on unmount. A tab uses no persistent bearer-token storage.

## Protocol

Connect to `/ws/boards/{boardId}` and send `hello` with the board token. OIDC and allowed-origin checks also apply to the WebSocket upgrade.

Mutating commands contain a UUID `commandId`, the board `epoch`, and a UUID `roundId` or `null`. The server stores command receipts for at least two days; participant tokens are valid for at most one day.

| Command | Behavior |
| --- | --- |
| `patch` with `elements` and `files` | Up to 100 elements and one new image; the server decides ownership and visibility |
| `start_round` | Host only; stores the roster and increments the epoch |
| `done` with `draftRevision` | Locks the acknowledged draft and publishes if all members are ready |
| `cancel_round` | Host only; deletes private contributions and ends the round |
| `resync` | Sends an authorized snapshot, limited to once every two seconds |
| `cursor` / `ping` | Sends transient position in standard mode or checks the connection |

Server events are `snapshot`, `patch`, `ack`, `round`, `metadata`, `presence`, `cursor`, `pong`, and `error`. The shared types live in [`protocol.ts`](../frontend/src/protocol.ts); [`protocolCodec.ts`](../frontend/src/protocolCodec.ts) validates incoming events.

Snapshots include image IDs, not image bytes. Assets are fetched individually through `GET /api/boards/{id}/assets/{assetId}` using `X-Board-Token` and the OIDC session. Asset responses use `Cache-Control: private, no-store`.

## Resource limits

| Resource | Limit |
| --- | --- |
| Open sockets | 200 total, 20 per company identity, 10 authenticated connections per board |
| Initial socket authentication | 10 seconds |
| Input bytes | 8 MB per connection and 64 MB globally per 10 seconds |
| Socket messages | 60 per second; up to 20 mutating commands per second |
| Persisted commands | 50,000 per participant per day |
| Stored participants | 200 per board |
| Board contents | 4,000 elements, 150 images, 4 MB scene JSON, 32 MB image JSON |
| Outgoing queue | 64 messages or 8 MB per connection; slow readers are disconnected |
| Images | PNG, JPEG, WebP, or GIF; 1 MB per file; at most 8,192 pixels per dimension and 16 megapixels |

For GIFs, the pixel budget covers the combined frame/canvas dimensions, with at most 100 frames. Animated PNG and WebP are rejected. Image signatures and metadata are checked before storage. SVG, embedded web content, and element links are not accepted.

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
