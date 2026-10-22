# TC-015: Remove persistent authorship from shared content

Status: Done
Priority: P0
Dependencies: TC-012

## Outcome

Remove persistent authorship from shared content. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Consolidate the initial schema without public element/image authors or page creators (approved initial-development reset policy).
- [x] Remove account attribution from shared command receipts and public copies.
- [x] Keep authorization membership independent from drawing storage.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Shared content has no persisted account-to-element mapping.
- [x] Initial schema reset policy is documented; no legacy upgrade compatibility is claimed.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Remove persistent authorship from shared content (TC-015)`.

## Completion evidence

The approved consolidated V1 schema removes persistent element/image/page authors and account-linked drawing receipts. Membership remains separate. Schema assertions and public/private protocol checks pass.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
