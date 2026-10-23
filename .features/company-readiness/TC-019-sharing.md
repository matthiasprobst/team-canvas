# TC-019: Expire invitations and clarify template publication

Status: Done
Priority: P1
Dependencies: TC-013, TC-018

## Outcome

Expire invitations and clarify template publication. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Expire invites after seven days; return expiresAt.
- [x] Limit active invites to 20; the consolidated initial schema has no legacy invitation migration.
- [x] Require explicit deployment-wide publication confirmation.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Preview and join enforce expiry and revocation under races.
- [x] Existing membership survives link expiry.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Expire invitations and clarify template publication (TC-019)`.

## Completion evidence

Seven-day/20-active invitation limits, expiry display and publication confirmation are implemented. PostgreSQL and authenticated sharing/template browser scenarios pass.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
