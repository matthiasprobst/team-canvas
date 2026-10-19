# TC-005: Share canvases through authenticated invitation acceptance

Status: In progress

Dependencies: [TC-001](TC-001-persistent-accounts-and-memberships.md), [TC-003](TC-003-keycloak-authentication-and-sessions.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a canvas owner, I want to send an invitation link that lets another signed-in user join my canvas and find it later in their dashboard.

## Implementation checklist

- [x] Provide owner-authorized invitation creation under /api/boards/{id}/invitations. Generate a cryptographically random secret, store only its hash, and return the raw secret only when creating the link.
- [x] Generate independent invitation records so making a new link does not invalidate earlier links. Links remain valid until revoked; creating a link does not revoke existing members.
- [x] Provide an authenticated invitation-preview endpoint that requires a valid canvas ID and secret before returning only the canvas title and owner.
- [x] Accept invitations through the board join flow after explicit user confirmation. Validate the secret, establish or reuse membership atomically, and open an independent session. Repeated acceptance must not duplicate membership.
- [x] Allow existing active members to reopen a canvas without reusing an invitation. An invitation grants ordinary member access, never ownership.
- [x] Adapt the existing host bulk-revocation behavior to revoke active invitation links and guest/member access, close affected sockets, and exclude revoked memberships from dashboard queries.
- [x] Keep denial responses non-disclosing and apply request limits. Do not record invitation secrets in logs or put them in URL query parameters.

## Acceptance criteria

- [ ] Only the owner can generate invitations; the board ID alone does not allow a new user to join.
- [ ] Opening a link without signing in cannot expose canvas metadata or content.
- [ ] Acceptance establishes durable membership, works idempotently, and rejects invalid or revoked secrets.
- [ ] Two separately generated invitation links both work until revoked.
- [ ] Revocation blocks future use of the links and affected sessions; ordinary token expiry does not revoke membership.
- [ ] Acceptance during poker does not add the new participant to the already-frozen round roster.

## Validation

Test invitation creation/preview/acceptance with owner, recipient, unrelated, and anonymous users. Include simultaneous acceptance, multiple links, revocation, reopened membership, and late arrival during poker.

## Completion notes

Added independent hashed invitation records, authenticated preview, explicit acceptance through membership-based join, and owner bulk revocation. Reactivation reuses the same participant ID. Revocation is serialized with socket events and can close shared members without altering poker rosters. Database integration tests are written but could not run through JDBC.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
