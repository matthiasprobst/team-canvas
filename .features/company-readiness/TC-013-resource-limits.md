# TC-013: Enforce configurable ownership, page, and storage quotas

Status: Todo
Priority: P1
Dependencies: TC-012

## Outcome

Enforce configurable ownership, page, and storage quotas. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Add validated maxPagesPerCanvas=10 and maxOwnedCanvasesPerUser=20 configuration.
- [ ] Count owned templates but exclude joined canvases.
- [ ] Serialize account creation and page growth checks.
- [ ] Enforce aggregate 20,000,000 element bytes and 128,000,000 image bytes; expose limits to clients.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Concurrent requests cannot exceed quotas.
- [ ] Lowering limits preserves existing data and rejects growth.
- [ ] Copies and ownership transfers obey limits.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Enforce configurable ownership, page, and storage quotas (TC-013)`.

## Completion evidence

Pending implementation and validation.
