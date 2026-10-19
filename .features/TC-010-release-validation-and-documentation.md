# TC-010: Validate and document the authenticated dashboard release

Status: In progress

Dependencies: [TC-001](TC-001-persistent-accounts-and-memberships.md), [TC-002](TC-002-development-keycloak.md), [TC-003](TC-003-keycloak-authentication-and-sessions.md), [TC-004](TC-004-canvas-dashboard-api.md), [TC-005](TC-005-invitation-api.md), [TC-006](TC-006-tailwind-ui-and-routing.md), [TC-007](TC-007-user-dashboard.md), [TC-008](TC-008-sharing-and-invitation-ui.md), [TC-009](TC-009-canvas-navigation-and-draft-protection.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a maintainer, I want a repeatable, documented release check proving that dashboard navigation and Keycloak access preserve collaboration and privacy.

## Implementation checklist

- [ ] Update CI and protocol smoke tests to use authenticated Keycloak sessions instead of the former guest-mode bypass. Run frontend checks/build, Kotlin tests, PostgreSQL integration tests, and complete Compose authentication/protocol flows.
- [ ] Add a browser acceptance journey with two Keycloak users covering first login, creation, invitation acceptance, shared dashboards, rename, canvas switching, a complete poker round, and logout.
- [ ] Check unauthorized API/asset/WebSocket requests, invalid/revoked invitations, session expiry, independent tabs/devices, and concurrent account/membership creation.
- [ ] Compare desktop/mobile dashboard renders with the approved visual reference. Record keyboard/focus, loading/error states, Excalidraw styling, and navigation protection results.
- [x] Update README, architecture/upgrade docs, environment examples, and Kubernetes templates for required Keycloak, English UI, public/internal URLs, and the new account/membership model.
- [x] Document fresh-development setup and the lack of legacy guest-account migration. Any database reset must be a deliberate developer action, never a startup side effect.
- [x] Preserve the one-backend-per-database deployment strategy, readiness probes, request limits, and privacy-safe logs. Record validation evidence and deployment-specific blockers in the relevant tickets; do not present unrun checks as passed.

## Acceptance criteria

- [ ] Automated checks use the required authentication path and pass for the new account/dashboard model.
- [ ] Two users complete the full dashboard → shared canvas → poker → navigation → logout journey.
- [ ] Localhost and a configured WLAN origin have verified sign-in, callback, sharing, and sign-out behavior.
- [ ] Production templates require HTTPS, secure cookies, real company Keycloak configuration, and one active backend.
- [ ] New setup documentation has no guest-mode instructions or expired environment-variable guidance presented as current behavior.
- [ ] Each implementation ticket has completed acceptance criteria and recorded validation evidence or an explicitly documented blocker before release review.

## Validation

Run the complete CI-equivalent checks and browser acceptance flow. Record exact commands/results, account scenarios, desktop/mobile screenshots, and WLAN/company-environment validation limits. Publishing or deployment is a separate action from completing these tickets.

## Completion notes

Updated CI to use real development Keycloak sessions, replaced guest-mode smoke, and added four browser tests. README, upgrade notes, architecture, and production templates reflect the new contract. Frontend/unit/schema/config checks pass within the documented limits. Full Maven build, JDBC integration, Compose/authentication, browser screenshots, WLAN checks, and release scans remain blocked or unrun.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
