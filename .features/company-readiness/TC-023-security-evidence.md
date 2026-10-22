# TC-023: Verify security boundaries and release dependencies

Status: In progress
Priority: P1
Dependencies: TC-019, TC-022

## Outcome

Verify security boundaries and release dependencies. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Verify claims, cookies, origins, proxy headers and external revocation timing.
- [ ] Reject unsupported editor actions and inspect approved browser destinations.
- [x] Move build dependencies to devDependencies.
- [x] Produce a resolved dependency/license inventory and run source/image/secret scans.
- [ ] Generate and retain final release SBOM artifacts.
- [ ] Fix the HIGH base-image findings and rescan.
- [x] Pin CI actions immutably.
- [ ] Complete the telemetry and browser-destination audit.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Authorization negative tests pass across all interfaces.
- [ ] Release evidence identifies versions, vulnerabilities and approved exceptions.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Verify security boundaries and release dependencies (TC-023)`.

## Completion evidence

Dependency overrides eliminate eight initial HIGH lockfile findings. The updated source scan has zero HIGH/CRITICAL findings and zero secrets; one LOW remains. Inventory covers 369 resolved packages with bundled MIT texts reviewed for missing metadata. Image scans found four backend and five frontend HIGH findings; no exceptions are approved. SBOM steps are configured in CI but final artifacts were not generated locally.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
