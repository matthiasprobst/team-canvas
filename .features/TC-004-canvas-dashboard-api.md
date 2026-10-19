# TC-004: List, create, and rename authorized canvases

Status: In progress

Dependencies: [TC-001](TC-001-persistent-accounts-and-memberships.md), [TC-003](TC-003-keycloak-authentication-and-sessions.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a user, I want to find my own and shared canvases, create a new canvas, and rename canvases I own.

## Implementation checklist

- [x] Add GET /api/boards with ownership filter (all, mine, shared), case-insensitive name search, pagination, and sort (recently opened, name). Scope every query to the authenticated owner or active member before filtering/pagination.
- [x] Return metadata-only summaries: canvas ID/name, owner ID/display name, owned/shared relationship, creation time, and the current membership’s last-opened time. Never include scene contents, private-round details, image bytes, tokens, or invitation secrets.
- [x] Use deterministic ordering, with last-opened descending and creation time as the fallback for unopened canvases; break ties by canvas ID. Use bounded pages (default 24, maximum 100) with a continuation cursor.
- [x] Make POST /api/boards atomically create the canvas and owner membership. Accept any authenticated user; no host key is needed by the new UI.
- [x] Add PATCH /api/boards/{id} for owner-only renaming. Trim names and reject empty names or names longer than 120 characters.
- [x] Update per-user last-opened metadata only after a successful authorized canvas open. Keep the existing ten-connection limit at connection admission, not dashboard listing.
- [x] Publish name changes to connected clients through a metadata-only update and refresh client list caches without replacing editor scenes. Apply existing authentication, request-size, and rate-limit controls to the new routes.

## Acceptance criteria

- [ ] Owned canvases appear immediately after creation; shared canvases appear only after invitation acceptance.
- [ ] Revoked members and unrelated users cannot discover canvas names, owners, or contents.
- [ ] Search, filters, ordering, and pagination operate over the complete authorized result set and have stable tie handling.
- [ ] Only the owner can rename; invalid names produce a usable validation error.
- [ ] A rename appears in the dashboard and open editor headers without interrupting a poker round or replacing unsaved scene state.
- [ ] Dashboard listing does not establish board WebSocket connections or consume room slots.

## Validation

Use API and PostgreSQL tests for owned/shared visibility, unauthorized probing, search/pagination, naming validation, atomic creation, per-user recency, and rename propagation during an active round.

## Completion notes

Added membership-scoped metadata lists, escaped name search, ownership filters, bounded deterministic cursor pagination, atomic owner creation, and owner-only rename. Renames broadcast a metadata event under the board event lock; the sync regression confirms pending private edits survive. SQL cursor queries execute in PostgreSQL single-user mode; complete API tests remain pending.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
