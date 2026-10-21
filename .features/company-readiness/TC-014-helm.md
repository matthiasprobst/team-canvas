# TC-014: Package the supported deployment with Helm

Status: Todo
Priority: P1
Dependencies: TC-012, TC-013

## Outcome

Package the supported deployment with Helm. Follow the agreed contracts in [the implementation plan](../../../docs/company-readiness-plan.md).

## Implementation

- [ ] Create a chart using external PostgreSQL, Keycloak, ingress and existing Secrets.
- [ ] Expose limits.maxPagesPerCanvas and limits.maxOwnedCanvasesPerUser with schema validation.
- [ ] Preserve security contexts, probes, network policies and one Recreate backend.
- [ ] Make Helm the primary production path.

## Interfaces and migrations

Use forward-only migrations; never rewrite applied migrations or reset data. Keep frontend/backend protocol and fixtures aligned. Preserve existing content; migration prerequisites must fail safely. See the security and operations documents for the cross-cutting contracts.

## Acceptance criteria

- [ ] Chart lint/render and invalid-value checks pass.
- [ ] Values reach backend enforcement; no credentials are committed.

## Validation

Run relevant unit and integration tests with PostgreSQL where persistence changes. Run frontend build and multi-browser checks for UI/protocol changes. Do not mark unrun checks as passed. Record exact commands and results below.

## Commit checkpoints

Commit coherent passing behavior with its tests and docs. Split storage foundations from the coordinated poker cutover. Suggested subject: `Package the supported deployment with Helm (TC-014)`.

## Completion evidence

Pending implementation and validation.
