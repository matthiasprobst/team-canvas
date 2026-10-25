# Production release acceptance

Status: implemented controls and local verification are not a company production approval. The historical [2026-10-22 checkpoint](../.features/company-readiness/validation.md) remains the source for its measured results. Update release-specific evidence after executing the checks below on the final candidate. No registry publication or company deployment is implied by adding workflows.

The company selects and operates staging and production. The code author delivers local qualification and the [operator handover](operator-handover.md); provisioning a company cluster or a specific hosting platform is not part of that delivery. Helm is one optional reference.

## Required release evidence

| Gate | Required evidence before admitting company data |
| --- | --- |
| Correctness | One uninterrupted green Verify run for the candidate commit, including backend/PostgreSQL, frontend, protocol and the complete browser suite. An individually passing scenario does not establish a complete suite. |
| Recovery | Full PostgreSQL dump/restore in isolation, current independently retained offboarding state and key ring, successful `prepare-restore`, preservation of drawings/images/pages/drafts, and revoked old sessions/invitations. Measure the company's actual RPO/RTO; the 24h/4h values are planning targets. |
| Upgrade | Rehearsal on populated data with separate migration/runtime roles, rejected concurrent writer, correct forward migration and content verification. Never treat image rollback as database rollback. |
| Load | Isolated 200-connection/20-canvas run at p95 acknowledgement below one second, with no lost acknowledged writes; additionally real slow-reader, reconnect and DB-session-loss scenarios. The checkpoint's 1171.6ms p95 failed the stated target. |
| Company environment acceptance | Company-owned staging on its chosen platform: HTTPS/WebSocket proxy, CA trust, network restrictions, narrowly trusted proxies, restricted DB roles, IdP revocation timing, process supervision, scrape reachability and tested alerts. On Kubernetes also verify the Helm installation/CNI. Local render/lint is insufficient for this operator-owned gate. |
| Security | Candidate scan reports, residual finding decisions, browser destination/telemetry review and company-specific threat review. Historical zero HIGH/CRITICAL does not describe a new build. |
| Ownership | Named service owner/on-call contact, maintenance and outage expectations, backup responsibility, retention settings, and independently stored offboarding exports after each irreversible action. |

Record the commit, image identities, commands, environment, timestamps, measurements and approver for each gate. An unexecuted or failed gate stays open. The repository does not assert that these operational gates have passed.

`tests/recovery.mjs` supplies a repeatable real dump/restore check using two new random databases in a disposable Compose project; see [rehearsal commands](operations-runbook.md#disposable-recovery-rehearsal). It checks complete row preservation on missing-key failure, private/shared content, retained ownership, session/invitation revocation and idempotent preparation. CI runs this after browser/protocol checks and retains the synthetic fixture timings. This closes no company-scale backup/RPO/RTO gate by itself.

## Build and publication identity

Verify builds backend and frontend images once. Compose uses those images for protocol/browser tests, and Trivy scans the same local images. Both runtime-image CycloneDX SBOMs, full-severity image scan JSON, commit, Docker image IDs, image archive and SHA-256 checksums are retained in `verified-runtime-images` for 14 days. Frontend source inventory is an additional artifact. Image scans record UNKNOWN/LOW/MEDIUM/HIGH/CRITICAL findings without suppressing unfixed issues. A separate `trivy convert` check of those same JSON reports blocks HIGH/CRITICAL vulnerabilities and secret findings without repeating the image scan. The generated reports are also retained in `runtime-security-reports` when this gate fails. Source and image gates include unfixed HIGH/CRITICAL vulnerabilities; waivers require an explicit reviewed policy change. Treat scan artifacts as sensitive because matched secret findings can contain secret values.

The optional `Publish verified images` workflow requires a successful completed Verify run triggered by a push on the repository default branch. It downloads that run's archive, validates checksums and commit/image IDs, rescans the images using the current scanner database, then applies the same HIGH/CRITICAL gate before tagging and pushing the loaded images to GHCR. It never rebuilds them. Complete current reports are retained separately as `publication-security-reports` even when the gate fails. Its successful `published-image-identities` artifact joins the tested local IDs, SBOMs, original and publication-time reports to the resulting registry references. Local Docker image IDs and registry manifest digests are different identifiers; deployment uses the latter (`repository@sha256:...`).

Configure the `production-release` GitHub environment with required reviewers and appropriate access before enabling promotion. Dispatch publication only for a reviewed candidate; it is independent of deployment. A newly discovered vulnerability can stop promotion even after Verify passed. If the 14-day archive expired, rerun verification rather than rebuilding and representing a new image as the tested candidate. Retain release evidence in company storage according to its audit policy.

## Supported availability limits

The backend supports one active instance with Recreate updates and maintenance downtime. The guard rejects overlapping writers; horizontal scaling and zero-downtime backend releases are unsupported. Budgets are 200 simultaneous sockets overall, 20 per account and ten per canvas. Tabs and reconnects consume this budget. Accept this service level explicitly or redesign and qualify the architecture before promising higher availability or capacity.

## Repeatable local load qualification

Provision fixture users only in a separate development Keycloak; this tool refuses realms without the supplied development markers and never overwrites existing accounts:

```sh
LOAD_PROVISION_CONFIRM=disposable TEST_KEYCLOAK_URL=http://localhost:8181/auth \
  node tests/provision-load-users.mjs

BASE_URL=http://localhost:8089 LOAD_PROFILE=capacity LOAD_SECONDS=60 \
  LOAD_REPORT=/tmp/canvas-capacity.json node tests/load.mjs
BASE_URL=http://localhost:8089 LOAD_PROFILE=workshop LOAD_SECONDS=60 \
  LOAD_SCENE_ELEMENTS=500 LOAD_REPORT=/tmp/canvas-workshop.json node tests/load.mjs
```

Use the actual disposable stack's ports, `BROWSER_EXECUTABLE` when needed, and changed development passwords via the corresponding `DEV_*_PASSWORD` variables. Run qualification without competing builds/scans/browser suites. The default target is p95 acknowledgement below 1000ms; record any deliberate target change. Capacity exercises 200 sockets/20 canvases at a five-second cadence. Workshop exercises ten writers on one canvas, a seeded scene/image, image downloads, and 110ms target cadence with acknowledgement backpressure. Reports include actual duration, achieved throughput, retries, reconnects and offline ticks; a good p95 alone does not establish sufficient throughput. A fixed-size histogram bounds long-run memory and conservatively rounds the p95 up to a 1ms bucket.

For a longer soak, `LOAD_SECONDS` supports up to four hours and `LOAD_INTERVAL_MS` can model a slower session. The harness refreshes expired company sessions and reconnects with the original command IDs; it never extends IdP lifetimes or bypasses the daily canvas quota. A sustained high-cadence workshop may legitimately reach that quota. These protocol loads do not measure editor rendering or qualify every slow-reader/network-failure scenario.
