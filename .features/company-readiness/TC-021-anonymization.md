# TC-021: Anonymize users while retaining their canvases

Status: Todo
Priority: P1
Dependencies: TC-020

## Outcome

Anonymize users while retaining their canvases. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Block reprovisioning with keyed identity fingerprints stored without placeholder mapping.
- [ ] Create distinct non-login deleted_user_N replacement owners.
- [ ] Transfer all canvases/templates; remove original identity, membership, session and duplicated names.
- [ ] Revoke associated invitations; retain other members and content.
- [ ] Allow explicit quota-checked reassignment to real accounts.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Identity disappears from live account data.
- [ ] Retained content and collaborator access survive.
- [ ] Replayed credentials cannot recreate an offboarded account.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Anonymize users while retaining their canvases (TC-021)`.

## Completion evidence

Pending implementation and validation.
