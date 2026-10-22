# TC-016: Introduce unlinked private-draft persistence

Status: Done
Priority: P0
Dependencies: TC-013, TC-015

## Outcome

Introduce unlinked private-draft persistence. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Use browser-generated random capabilities and store only hashes.
- [x] Require current membership and a valid capability for private reads/writes.
- [x] Scope receipts to canvas or private capability, not accounts.
- [x] Bound drafts to 200 per round and apply storage/rate limits.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Wrong capability and revoked membership fail.
- [x] No persisted account/session/participant mapping identifies a private draft.
- [x] Retries remain idempotent.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Introduce unlinked private-draft persistence (TC-016)`.

## Completion evidence

Capability hashes, membership checks, private image authorization, scoped receipts and draft bounds are implemented. PostgreSQL tests and the live authenticated WebSocket smoke test pass, including wrong-capability rejection and idempotent retries.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
