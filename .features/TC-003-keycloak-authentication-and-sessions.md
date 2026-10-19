# TC-003: Require Keycloak login and provision user accounts

Status: In progress

Dependencies: [TC-001](TC-001-persistent-accounts-and-memberships.md), [TC-002](TC-002-development-keycloak.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a company user, I want to sign in with Keycloak and receive a personal Team Canvas account automatically.

## Implementation checklist

- [x] Require validated Keycloak authentication for application APIs, board assets, and WebSocket upgrades. Remove supported runtime guest-access bypasses and host-key authority; public static assets and the sign-in screen may remain public.
- [x] Use Quarkus’s server-managed OIDC authorization-code flow. Keep identity-provider tokens outside browser JavaScript and use secure, HttpOnly session cookies in production.
- [x] Provision or refresh the local account after successful authentication using verified issuer/subject claims. Use trusted display-name claims rather than a client-supplied identity. All users admitted by the configured realm/client may use the app.
- [x] Add GET /api/me returning the current account’s ID and display name. Provide consistent unauthenticated API handling and safe local return paths for top-level sign-in redirects.
- [x] Adapt board join/authentication and WebSocket checks to durable membership plus independent expiring sessions. Derive host permission from canvas ownership. Opening a new session must not rotate another session’s token.
- [x] Link board sessions to the verified Keycloak login-session identifier. Logout revokes sessions for that login and closes its sockets before completing OIDC logout; another device’s independent login remains usable.
- [x] Preserve session-expiry enforcement and existing connection limits. Return structured authorization errors without logging tokens, invitation secrets, or drawing data.

## Acceptance criteria

- [ ] An authenticated first login creates an account and GET /api/me returns it; later logins reuse that account.
- [ ] Anonymous requests cannot list, create, open, rename, share, edit, or download canvas content.
- [ ] Invalid, expired, wrong-issuer, or identity-mismatched credentials fail closed for HTTP and WebSockets.
- [ ] Two tabs/devices for one account retain independent sessions and the same canvas participant identity.
- [ ] Logout makes the current login’s open sockets and board sessions unusable and clears user-specific client state.
- [ ] Sign-in restores safe requested routes and supports the pending-invitation flow specified in TC-008.

## Validation

Add authentication and authorization integration tests using the development Keycloak realm. Exercise first login, concurrent provisioning, expiry, logout, identity mismatch, HTTP/WebSocket identity consistency, and independent sessions. Run the existing privacy and connection-limit regressions.

## Completion notes

Required Quarkus OIDC on data APIs and WebSocket upgrades; removed supported guest bypasses and legacy host-key authority. Added /api/me, verified issuer/sub/sid provisioning, login-bound board sessions, logout revocation/socket closure, and RP logout. JWT boundary unit tests pass. Real Keycloak HTTP/WebSocket and multi-device acceptance remain unrun.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
