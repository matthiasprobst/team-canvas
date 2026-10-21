# Company readiness implementation backlog

Status: In progress. TC-011 documents the agreed target; application tickets are not completed by this documentation commit.

## Decisions

No persisted drawing authorship. Any member can start/stop poker; shared content stays visible and locked. Hidden drafts use unlinked capabilities. Helm defaults to 10 pages and 20 owned canvases. Administrators may deactivate, anonymize (retain content), or delete (delete all owned canvases).

## Tickets

| Ticket | Outcome | Priority | Dependencies | Status |
| --- | --- | --- | --- | --- |
| [TC-011](TC-011-architecture-and-backlog.md) | Record the agreed architecture and backlog | P0 | None | Done |
| [TC-012](TC-012-safe-upgrades.md) | Make startup and schema upgrades non-destructive | P0 | TC-011 | Todo |
| [TC-013](TC-013-resource-limits.md) | Enforce configurable ownership, page, and storage quotas | P1 | TC-012 | Todo |
| [TC-014](TC-014-helm.md) | Package the supported deployment with Helm | P1 | TC-012, TC-013 | Todo |
| [TC-015](TC-015-shared-data-minimization.md) | Remove persistent authorship from shared content | P0 | TC-012 | Todo |
| [TC-016](TC-016-private-capabilities.md) | Introduce unlinked private-draft persistence | P0 | TC-013, TC-015 | Todo |
| [TC-017](TC-017-poker-switch.md) | Replace readiness poker with member-operated reveal | P0 | TC-016 | Todo |
| [TC-018](TC-018-multipage-templates.md) | Copy complete independent multi-page templates | P1 | TC-013, TC-017 | Todo |
| [TC-019](TC-019-sharing.md) | Expire invitations and clarify template publication | P1 | TC-013, TC-018 | Todo |
| [TC-020](TC-020-admin-deactivation.md) | Add administrator access and account deactivation | P1 | TC-014, TC-017 | Todo |
| [TC-021](TC-021-anonymization.md) | Anonymize users while retaining their canvases | P1 | TC-020 | Todo |
| [TC-022](TC-022-user-deletion.md) | Delete users and every canvas they own | P1 | TC-021 | Todo |
| [TC-023](TC-023-security-evidence.md) | Verify security boundaries and release dependencies | P1 | TC-019, TC-022 | Todo |
| [TC-024](TC-024-operations.md) | Implement cleanup and recovery procedures | P1 | TC-014, TC-021, TC-022 | Todo |
| [TC-025](TC-025-qualification.md) | Qualify the company-ready release | P0 | TC-011, TC-012, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-020, TC-021, TC-022, TC-023, TC-024 | Todo |

## Delivery and commits

1. Foundations: TC-011–TC-014.
2. Privacy/poker: TC-015–TC-017 (frontend/backend cut over together).
3. Templates/sharing: TC-018–TC-019.
4. Administration: TC-020–TC-022.
5. Security/operations/release: TC-023–TC-025.

Commit each coherent passing slice with tests and documentation. Keep status and evidence current. Local commits do not imply deployment approval. Older TC-001–TC-010 tickets are historical; their readiness-roster requirements are superseded by TC-017.
