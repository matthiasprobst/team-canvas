# TC-018: Copy complete independent multi-page templates

Status: Done
Priority: P1
Dependencies: TC-013, TC-017

## Outcome

Copy complete independent multi-page templates. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Copy all ordered pages, including empty pages; select the first.
- [x] Copy only live shared elements and referenced images with remapped bindings.
- [x] Exclude private data, capabilities, memberships, invites and rounds.
- [x] Check quotas atomically and preserve tags without drawing attribution.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Multi-page copies are independent and contain no hidden work.
- [x] Failure leaves no partial canvas.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Copy complete independent multi-page templates (TC-018)`.

## Completion evidence

All ordered pages, empty pages and referenced public images are independently copied with remapped bindings and atomic quotas. PostgreSQL and template/page browser scenarios pass.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
