# TC-001: Persist accounts, canvas ownership, memberships, and independent sessions

Status: In progress

Dependencies: None

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a signed-in user, I want my canvases and memberships to survive browser restarts and be available on other devices.

## Implementation checklist

- [x] Add a forward Flyway migration for local accounts uniquely identified by verified OIDC issuer and subject, with display-name and lifecycle timestamps.
- [x] Link each newly created canvas to its owning account. Represent membership using a stable participant identity linked to the account, unique per account and canvas; retain that participant ID for scene authorship, poker rosters, and command receipts.
- [x] Separate durable membership from expiring board sessions. Store hashed session tokens and their expiry, revocation state, participant, and verified Keycloak login-session identifier independently. Token expiry must not remove membership.
- [x] Add invitation records with hashed secrets, canvas association, creator, and revocation state. Support multiple independently valid invitation links.
- [x] Store last-opened time per membership and add indexes for identity lookup, membership lookup, invitation/session validation, and dashboard ordering.
- [x] Retain existing stored development rows without exposing unowned legacy canvases to new accounts. No guest-account claiming, legacy-key authentication, or automatic database deletion is required.
- [x] Keep account and membership persistence in focused repository/service code; update model types and existing foreign-key usage coherently.

## Acceptance criteria

- [ ] Repeated or concurrent first logins create exactly one account for the same issuer/subject pair.
- [ ] The same subject from another issuer cannot acquire the first account’s access.
- [ ] Each account has at most one active participant identity per canvas; multiple tabs do not duplicate the poker roster.
- [ ] Two independent board-session tokens can coexist for one membership; expiration of one does not remove membership or invalidate the other.
- [x] Both an empty database and the current schema upgrade successfully; the migration does not delete existing scene data.
- [ ] Unclaimed legacy guest records are excluded from authenticated dashboard queries.

## Validation

Run PostgreSQL integration tests for migration, uniqueness under concurrency, independent sessions, foreign keys, and retained scene data. Test membership persistence separately from token expiry.

## Completion notes

Added V3 accounts, login ledger, account ownership, stable participant membership, independent hashed board sessions, and invitation records. Legacy rows remain unclaimed. Empty-schema and populated-V2 migration checks passed in PostgreSQL single-user mode. Concurrency, independent-session expiry, cross-issuer isolation, and retained-member tests are added; their JDBC execution is blocked.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
