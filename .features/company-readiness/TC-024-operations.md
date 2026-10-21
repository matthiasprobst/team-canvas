# TC-024: Implement cleanup and recovery procedures

Status: Todo
Priority: P1
Dependencies: TC-014, TC-021, TC-022

## Outcome

Implement cleanup and recovery procedures. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Bound cleanup of expired sessions, invites and receipts without weakening revocation.
- [ ] Document secret rotation, writer loss, offboarding, backup, migration and restore.
- [ ] Invalidate restored sessions/invites and reapply current offboarding before reopening.
- [ ] Target 24h RPO, 4h RTO, 30d encrypted backups and 90d security logs.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Timed restore preserves content without resurrecting access.
- [ ] Historical backup identity and author retention is explained.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Implement cleanup and recovery procedures (TC-024)`.

## Completion evidence

Pending implementation and validation.
