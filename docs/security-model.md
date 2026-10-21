# Security model

Status: target contract; implementation evidence is tracked in [tickets](../.features/company-readiness/README.md).

## Boundaries and data

Trust boundaries: browser/HTTPS ingress, ingress/Caddy/backend, backend/PostgreSQL, browser/backend/Keycloak, CI/registry/deployment, and operators/backups/secrets/logs. Company administrators are trusted. Store identity and membership for access; store no shared drawing authorship. Capabilities protect private drafts but do not replace membership. User-entered text and images can identify people; this system does not promise anonymous content or end-to-end encryption.

## Permission matrix

| Action | Unrelated user | Member | Owner | App admin |
| --- | --- | --- | --- | --- |
| Read/edit shared canvas | No | Yes | Yes | Only through membership |
| Read private draft | No | Own capability only | Own capability only | No general private API |
| Start/stop poker | No | Yes | Yes | Only through membership |
| Share/publish/delete canvas | No | No | Yes | Explicit lifecycle/reassignment operations |
| Deactivate/anonymize/delete user | No | No | No | Yes, validated client role |

## Invariants

Quarkus validates issuer/subject/session and expiry. Enforce membership on every request and command, origins on state-changing requests and WebSocket upgrades, and current deactivation status. Never publish private content before an explicit stop. Authorize images like elements. Receipt replay must be context-scoped and idempotent. Ack follows commit. Loss of the single-writer session rejects access. Logs, metrics, URLs and traces must not contain tokens, invitation secrets, capabilities, drawing contents or an account-to-drawing chain.

## Offboarding and residual risks

Deactivate is reversible, anonymize and delete are not. Remove duplicated names and identity references; prevent reprovisioning after deletion with an externally keyed fingerprint. Do not retain a link to a placeholder owner. Infrastructure logs and historical backups can retain earlier identity until their retention expires. Restore must reapply offboarding and scrub old authorship before service opens. Secret loss can prevent recovery; keep blocking keys in managed secret storage. Browser capability loss prevents personal draft reopening, but saved content can still be revealed by another member. Application admins must not get a private-draft inspection endpoint.

## Required negative tests

Wrong issuer, expiry, missing session, revoked membership, deactivated accounts, old cookies, foreign assets, incorrect capability, unsupported protocol, CSRF/origin rejection, forged proxy headers, quota races, duplicated reveal, late private writes, failed migration, account resurrection after restore, and secret/author leakage.
