# TC-023: Verify security boundaries and release dependencies

Status: Todo
Priority: P1
Dependencies: TC-019, TC-022

## Outcome

Verify security boundaries and release dependencies. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Verify claims, cookies, origins, proxy headers and external revocation timing.
- [ ] Reject unsupported editor actions and inspect approved browser destinations.
- [ ] Move build dependencies to devDependencies.
- [ ] Produce dependency/license inventories, SBOMs and source/image/secret scans.
- [ ] Pin CI actions immutably and audit privacy-safe telemetry.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Authorization negative tests pass across all interfaces.
- [ ] Release evidence identifies versions, vulnerabilities and approved exceptions.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Verify security boundaries and release dependencies (TC-023)`.

## Completion evidence

Pending implementation and validation.
