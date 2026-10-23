# TC-024: Implement cleanup and recovery procedures

Status: In progress
Priority: P1
Dependencies: TC-014, TC-021, TC-022

## Outcome

Implement cleanup and recovery procedures. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Bound cleanup of expired sessions, invites and receipts without weakening revocation.
- [x] Document secret rotation, writer loss, offboarding, backup, migration and restore.
- [x] Invalidate restored sessions/invites and reapply current offboarding before reopening.
- [x] Target 24h RPO, 4h RTO, 30d encrypted backups and 90d security logs.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Timed restore preserves content without resurrecting access.
- [x] Historical backup identity and author retention is explained.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Implement cleanup and recovery procedures (TC-024)`.

## Completion evidence

Bounded cleanup, independent keyed offboarding export and exclusive restore preparation are implemented and tested. Tests restore old identity rows and verify retention/deletion, revoked sessions, missing-key rejection and bounded cleanup. Full timed dump/restore and company retention/RPO/RTO verification remain open.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
