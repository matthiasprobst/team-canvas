# TC-012: Make startup and schema upgrades non-destructive

Status: In progress
Priority: P0
Dependencies: TC-011

## Outcome

Make startup and schema upgrades non-destructive. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Remove startup cleanup and explicitly disable Flyway cleaning.
- [x] Add migration-only execution in the existing image; separate runtime and migration credentials.
- [x] Validate schema during production startup; keep development migrations automatic.
- [x] Standardize JDK 21, Maven 3.9+, and Node 24.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Migration validation failure preserves populated data.
- [x] Migration command opens no HTTP endpoints; runtime requires no DDL.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Make startup and schema upgrades non-destructive (TC-012)`.

## Completion evidence

Standalone migration succeeded on a fresh Compose database. Startup rejected its unmigrated schema without cleaning it. All 65 backend tests pass with PostgreSQL, including application create/join under a DML-only role that cannot create/alter tables or modify Flyway history. Populated migration-failure rehearsal remains open.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
