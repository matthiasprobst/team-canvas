# TC-019: Expire invitations and clarify template publication

Status: Todo
Priority: P1
Dependencies: TC-013, TC-018

## Outcome

Expire invitations and clarify template publication. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Expire invites after seven days; return expiresAt.
- [ ] Limit active invites to 20 and expire legacy links seven days after migration.
- [ ] Require explicit deployment-wide publication confirmation.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Preview and join enforce expiry and revocation under races.
- [ ] Existing membership survives link expiry.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Expire invitations and clarify template publication (TC-019)`.

## Completion evidence

Pending implementation and validation.
