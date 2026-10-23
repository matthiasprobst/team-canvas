# TC-025: Qualify the company-ready release

Status: In progress
Priority: P0
Dependencies: TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024

## Outcome

Qualify the company-ready release. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Run frontend, backend, PostgreSQL, protocol and multi-browser checks; see rerun limitation below.
- [x] Exercise fresh install and fail-closed startup before migration.
- [x] Lint/render Helm and reject invalid quota values.
- [ ] Exercise populated migration rejection, full dump/restore and live Helm deployment.
- [x] Run source/image/license scans and a controlled load test; findings remain open.
- [x] Record commits, scanned image identifiers, commands, outcomes and limitations.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] No required integration checks are unexpectedly skipped.
- [ ] Test 200 connections across 20 canvases including overload and slow readers.
- [x] Documents describe verified behavior and remaining limitations.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Qualify the company-ready release (TC-025)`.

## Completion evidence

65 backend tests pass without skips, production packaging passes, four sync tests pass, and live WebSocket smoke passes. Nine original browser scenarios passed; the added administration scenario passed separately after fixes. A subsequent overlapping browser run had timeouts/artifact collisions, so one clean full-suite run remains required. Load: 200 sockets/20 canvases, all 2,400 writes acknowledged, overflow closed 1013, p95 1171.6 ms versus the 1000 ms target. No clean-load rerun or real-network slow-reader run was completed. See the validation record for open release gates.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
