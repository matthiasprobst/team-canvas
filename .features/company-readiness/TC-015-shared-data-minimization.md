# TC-015: Remove persistent authorship from shared content

Status: Todo
Priority: P0
Dependencies: TC-012

## Outcome

Remove persistent authorship from shared content. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Scrub public element/image authors and page creators with forward migrations.
- [ ] Remove account attribution from shared command receipts and public copies.
- [ ] Keep authorization membership independent from drawing storage.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Shared content has no persisted account-to-element mapping.
- [ ] Existing drawings survive migration.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Remove persistent authorship from shared content (TC-015)`.

## Completion evidence

Pending implementation and validation.
