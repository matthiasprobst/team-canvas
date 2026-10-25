# TC-021: Anonymize users while retaining their canvases

Status: Done
Priority: P1
Dependencies: TC-020

## Outcome

Anonymize users while retaining their canvases. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Block reprovisioning with keyed identity fingerprints stored without placeholder mapping.
- [x] Create distinct non-login deleted_user_N replacement owners.
- [x] Transfer all canvases/templates; remove original identity, membership, session and duplicated names.
- [x] Revoke associated invitations; retain other members and content.
- [x] Allow explicit quota-checked reassignment to real accounts.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Identity disappears from live account data.
- [x] Retained content and collaborator access survive.
- [x] Replayed credentials cannot recreate an offboarded account.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Anonymize users while retaining their canvases (TC-021)`.

## Completion evidence

Unlinked identity fingerprints, distinct non-login placeholders, content retention and quota-checked reassignment are implemented. PostgreSQL and administration browser checks verify blocked reprovisioning and retained collaborator access.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
