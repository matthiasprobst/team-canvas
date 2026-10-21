# TC-025: Qualify the company-ready release

Status: Todo
Priority: P0
Dependencies: TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024

## Outcome

Qualify the company-ready release. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Run frontend, backend, PostgreSQL, protocol and multi-browser checks.
- [ ] Exercise fresh install, populated upgrade, rejected migration, restore and Helm deployment.
- [ ] Run source/image/license scans and controlled load tests.
- [ ] Record exact commits, image digests, commands, outcomes and limitations.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] No required integration checks are unexpectedly skipped.
- [ ] Test 200 connections across 20 canvases including overload and slow readers.
- [ ] Documents describe verified behavior and remaining limitations.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Qualify the company-ready release (TC-025)`.

## Completion evidence

Pending implementation and validation.
