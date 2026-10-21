# TC-020: Add administrator access and account deactivation

Status: In review
Priority: P1
Dependencies: TC-014, TC-017

## Outcome

Add administrator access and account deactivation. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Require validated Keycloak client role team-canvas-admin.
- [ ] Add paginated admin users and impact preview.
- [ ] Implement deactivate/reactivate with session revocation and socket closure.
- [ ] Enforce status across provisioning, HTTP, assets and sockets.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Direct admin API requests require the role.
- [ ] Old credentials cannot bypass local deactivation.
- [ ] Reactivation requires fresh sessions.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Add administrator access and account deactivation (TC-020)`.

## Completion evidence

Implemented role-protected administration, immediate deactivation, keyed identity blocking, anonymization, retained-canvas reassignment and distinct owned-canvas deletion. PostgreSQL/backend suite: 62 passed, no skips. Lifecycle tests include stale previews, confirmation, self-protection and concurrent provisioning. Frontend type-check passed; real SSO/browser role checks pending.
