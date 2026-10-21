# TC-017: Replace readiness poker with member-operated reveal

Status: Todo
Priority: P0
Dependencies: TC-016

## Outcome

Replace readiness poker with member-operated reveal. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Any member can start_round or stop_round.
- [ ] Keep the shared base visible and locked; reveal saved private contributions atomically.
- [ ] Remove readiness, rosters, done, and ordinary cancellation controls.
- [ ] Preserve stale private writes for local recovery; never silently publish them.
- [ ] Reject old protocol versions and update frontend/backend together.
- [ ] Require finishing legacy active rounds before upgrade.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Owner departure does not block reveal.
- [ ] Concurrent stops reveal once; offline saved contributions are included.
- [ ] Private associations disappear at reveal.
- [ ] Frontend build, protocol and browser tests use the new contract.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Replace readiness poker with member-operated reveal (TC-017)`.

## Completion evidence

Pending implementation and validation.
