# TC-012: Make startup and schema upgrades non-destructive

Status: Todo
Priority: P0
Dependencies: TC-011

## Outcome

Make startup and schema upgrades non-destructive. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Remove startup cleanup and explicitly disable Flyway cleaning.
- [ ] Add migration-only execution in the existing image; separate runtime and migration credentials.
- [ ] Validate schema during production startup; keep development migrations automatic.
- [ ] Standardize JDK 21, Maven 3.9+, and Node 24.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Migration validation failure preserves populated data.
- [ ] Migration command opens no HTTP endpoints; runtime requires no DDL.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Make startup and schema upgrades non-destructive (TC-012)`.

## Completion evidence

Pending implementation and validation.
