# TC-013: Enforce configurable ownership, page, and storage quotas

Status: Done
Priority: P1
Dependencies: TC-012

## Outcome

Enforce configurable ownership, page, and storage quotas. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Add validated maxPagesPerCanvas=10 and maxOwnedCanvasesPerUser=20 configuration.
- [x] Count owned templates but exclude joined canvases.
- [x] Serialize account creation and page growth checks.
- [x] Enforce aggregate 20,000,000 element bytes and 128,000,000 image bytes; expose limits to clients.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Concurrent requests cannot exceed quotas.
- [x] Lowering limits preserves existing data and rejects growth.
- [x] Copies and ownership transfers obey limits.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Enforce configurable ownership, page, and storage quotas (TC-013)`.

## Completion evidence

Configurable 10-page/20-owned-canvas defaults, account/page locking, aggregate budgets and client metadata are implemented. PostgreSQL tests cover concurrent creation, lowered limits, copies and ownership reassignment.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
