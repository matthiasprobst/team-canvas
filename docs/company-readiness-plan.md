# Company-readiness implementation plan

Status: agreed target, not a claim that application work is complete. See [tickets](../.features/company-readiness/README.md).

## Architecture and scope

Keep React/Excalidraw, Kotlin/Quarkus, PostgreSQL, Caddy, company Keycloak, one backend, ten connections per canvas and planned upgrade downtime. No new application service or provider integration. Core workflows are multi-page canvases, persistent sharing, templates, and member-operated poker. Full export/import and revision history are deferred.

## Persistence and poker

Saved shared elements, images, page metadata, and drawing receipts must contain no author mapping. Canvas ownership and membership remain for authorization. Any member starts/stops poker. Existing shared drawings stay visible and locked. Each browser sees its hidden additions through a random capability stored in sessionStorage, while the database stores only its hash. Membership is required as well as the capability. Do not persist a capability/account/session mapping. Stop atomically reveals all acknowledged private contributions, including those from disconnected browsers. Remove private associations at reveal. No readiness roster, done command or ordinary cancellation. Reject stale private writes and preserve them locally rather than automatically publishing them.

## Configuration

Helm is the primary Kubernetes packaging and uses external company services. Values `limits.maxPagesPerCanvas: 10` and `limits.maxOwnedCanvasesPerUser: 20` are positive integers, backend-enforced and exposed to the UI. Templates count as owned; joined canvases do not. Lowered limits preserve existing data. Enforce aggregate canvas budgets of 20,000,000 element bytes and 128,000,000 image bytes and existing per-page protections. Bound private drafts to 200 per round. Invitations expire after seven days, with at most 20 active links per canvas.

## Templates and administration

Templates copy all ordered pages and only live shared content with independent IDs/bindings. Exclude private work, credentials, round state, invitations and membership. Default private; confirm deployment-wide publication.

A small admin page requires the Keycloak client role `team-canvas-admin`. Deactivate immediately blocks access and revokes sessions; reactivate requires fresh sessions. Anonymize creates a distinct non-login `deleted_user_N`, retains owned canvases and other memberships, and removes old identity and duplicated metadata. Delete removes the account and every owned canvas, including shared ones, after impact preview and explicit confirmation; other owners' canvases survive. Block identity reprovisioning with a keyed fingerprint whose secret is external to the database. No placeholder-to-original mapping is retained. Existing shared content is unattributed and is not searched for the departed user's contributions.

## Delivery and acceptance

Use forward migrations only. Disable automatic cleanup, separate runtime/migration roles and provide migration-only execution. Old active poker rounds must finish or be explicitly cancelled before migration. Reject unsupported protocol versions. Commit passing slices regularly, keep the frontend/backend cutover coherent, and attach evidence to ticket/commit. Release requires real PostgreSQL integration, authenticated protocol and multi-browser checks, populated upgrades, restore, Helm validation, security scans and measured load. Configuration alone is not release evidence.
