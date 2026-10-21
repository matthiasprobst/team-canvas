# TC-022: Delete users and every canvas they own

Status: Todo
Priority: P1
Dependencies: TC-021

## Outcome

Delete users and every canvas they own. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Preview every affected owned canvas and explicitly warn about shared content deletion.
- [ ] Require deliberate confirmation and deactivate first.
- [ ] Atomically delete owned canvases and identity; notify connected viewers.
- [ ] Keep other users canvases and their unattributed drawings.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Repeated and concurrent operations remain consistent.
- [ ] Deletion and anonymization have separate, unambiguous effects.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Delete users and every canvas they own (TC-022)`.

## Completion evidence

Pending implementation and validation.
