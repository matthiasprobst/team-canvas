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
- [x] Generate and retain CycloneDX SBOM artifacts for the qualified image digests.
- [x] Fix the HIGH base-image findings and rescan.
- [x] Pin CI actions immutably.
- [ ] Complete the telemetry and browser-destination audit.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Authorization negative tests pass across all interfaces.
- [x] Release evidence identifies versions, vulnerabilities and the current exception status.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Verify security boundaries and release dependencies (TC-023)`.

## Completion evidence

Dependency overrides eliminate eight initial HIGH lockfile findings. The updated source scan has zero HIGH/CRITICAL findings and zero secrets; one LOW remains. Inventory covers 369 resolved packages with bundled MIT texts reviewed for missing metadata.

The original image findings were addressed by using the Temurin Noble runtime and rebuilding Caddy 2.11.7 with Go 1.27.3 and `golang.org/x/net` 0.60.0. The rebuilt backend and frontend images have zero HIGH/CRITICAL findings and zero secrets. Remaining results are 27 MEDIUM and 4 LOW in the backend, and one UNKNOWN in the frontend; they still need release-owner review. CycloneDX SBOMs are retained under `artifacts/sbom/` for the scanned image digests. Claim, cookie, origin, telemetry and destination audits remain open.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
