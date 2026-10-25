# TC-014: Package the supported deployment with Helm

Status: Done
Priority: P1
Dependencies: TC-012, TC-013

## Outcome

Package the supported deployment with Helm. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [x] Create a chart using external PostgreSQL, Keycloak, ingress and existing Secrets.
- [x] Expose limits.maxPagesPerCanvas and limits.maxOwnedCanvasesPerUser with schema validation.
- [x] Preserve security contexts, probes, network policies and one Recreate backend.
- [x] Make Helm the primary production path.

## Interfaces and migrations

Initial development: schema files may be consolidated. Reset only explicitly disposable data; startup must never clean it automatically. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [x] Chart lint/render and invalid-value checks pass.
- [x] Values reach backend enforcement; no credentials are committed.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Package the supported deployment with Helm (TC-014)`.

## Completion evidence

Chart, value schema, external services/secrets, migration Job and single Recreate backend are implemented. Lint/render and invalid quota rejection passed; 7-page/12-canvas overrides were rendered. Live company-cluster qualification belongs to TC-025.

See [the validation record](validation.md) for commands, checkpoints and release limitations.
