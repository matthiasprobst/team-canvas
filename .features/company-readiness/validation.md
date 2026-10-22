# Implementation checkpoint — 2026-10-22

Work is committed on `company-readiness` in `/tmp/team-canvas-company-readiness`, based on `1d6ba68`. The original `hardening` checkout and its unrelated edits were preserved. This checkpoint implements the core scope; it is not approval for a company rollout.

## Completed verification

| Check | Evidence |
| --- | --- |
| PostgreSQL/backend | `TEAM_CANVAS_TEST_JDBC_URL=jdbc:postgresql://localhost:55439/qualification DB_USER=board DB_PASSWORD=board-test mvn -o verify` from `backend`: **65 passed, zero failures/errors/skips**, production augmentation passed. Separate test database avoids colliding with the running app's database-wide writer lock. |
| Runtime database permissions | Actual account/canvas create, join and authentication succeed with DML grants; CREATE TABLE, ALTER TABLE and Flyway-history mutation fail. |
| Frontend | Production image build and `npm run test:sync --prefix frontend` passed; four sync tests. Images use Node 24/npm 11.19.1. Host test runner used Node 22.15.0. |
| Initial deployment | Isolated Compose stack `team-canvas-readiness`, PostgreSQL 17.11, application `http://localhost:18098`, development Keycloak `http://localhost:18198/auth`. Unmigrated startup failed closed; separate `docker compose run --rm --no-deps backend migrate` succeeded, then backend became healthy. |
| Live protocol | `BASE_URL=… BROWSER_EXECUTABLE=… node tests/smoke.mjs`: public replay, private elements/images, wrong capability rejection, member reveal after owner departure, stale private-write rejection, page/image copying and ten connections passed. |
| Browser flows | Nine original Playwright scenarios passed in the first run. The added administration scenario subsequently passed separately after fixing a misplaced React hook, an asynchronous test race and a locator. Screenshots captured desktop confirmation and mobile administration. |
| Helm | Earlier lint/render passed, positive overrides 7 pages/12 owned canvases rendered, zero-page value rejected. No live Kubernetes installation was performed. |
| Source dependencies | Trivy 0.76.1 lockfile scan after overrides: **zero HIGH/CRITICAL**, one LOW, zero secrets. Initial scan had eight HIGH findings. Inventory records 369 resolved packages; bundled MIT licenses verified for fuzzy 0.1.3 and khroma 2.1.0, whose metadata omitted licenses. |
| Recovery logic | Integration tests simulate identities restored from old snapshots and check current anonymize/delete decisions, key-ring validation, access invalidation and bounded cleanup. This is not a timed full backup restore. |

Browser commands require an explicit disposable `BASE_URL`; executable used was `/home/matthias/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`. Administration tests irreversibly offboard development Carol/Dave accounts; use a fresh isolated fixture for another full run. Do not target retained company data.

## Load result

`BASE_URL=… BROWSER_EXECUTABLE=… node tests/load.mjs` connected **200 authenticated sockets across 20 canvases and ten accounts** for 60 seconds. All **2,400 writes were acknowledged**, with no command errors or lost connections; the overflow socket closed with **1013**. Acknowledgement p95 was **1171.6 ms**, maximum **1484.9 ms**. The one-second p95 assertion therefore failed. Other tests/scans were running on the same host; a clean repeat is required before interpreting capacity. Do not claim the latency target passed.

The harness requires test-only Keycloak users `load01`…`load10`, with completed profiles and `<username>-dev-only` passwords (or `DEV_LOAD01_PASSWORD` etc.). They were provisioned only in the isolated development provider, not added to production configuration. The harness removes only canvases it created. Unit tests cover bounded slow-reader queues; real-network slow-reader qualification remains open.

## Release gates still open

- [ ] Fix and rescan base-image vulnerabilities. Trivy found **four HIGH** Go findings in backend `/usr/bin/pebble`, and **five HIGH** Go/x/net findings in frontend Caddy. No secret findings and no approved vulnerability exceptions. Candidate Dockerfile changes were reverted when wrap-up was requested; the replacement builds were stopped.
- [ ] Generate and retain final frontend/backend SBOMs and approved license/vulnerability reports. CI includes generation and HIGH/CRITICAL gates; those jobs were not executed here.
- [ ] Run one clean, uninterrupted complete browser suite. An overlapping rerun hit timeouts and shared artifact-directory collisions; separate passing scenarios do not establish a green full-suite rerun.
- [ ] Repeat the load run without competing builds/scans; investigate if p95 still exceeds one second, then exercise real-network slow readers and reconnect behavior.
- [ ] Rehearse migration rejection against populated retained data and a full PostgreSQL dump/restore with independently retained offboarding state. Initial schema consolidation was explicitly authorized; no legacy upgrade compatibility is claimed.
- [ ] Install Helm in the target company cluster and verify ingress, TLS/CA trust, policies, runtime/migration credentials, external Keycloak revocation timing, backup retention and measured RPO/RTO.
- [ ] Complete the browser-destination/telemetry review and resolve any remaining deployment-specific security findings.

Scanned local image identifiers (before any future rebuild):

| Image | Scan identifier |
| --- | --- |
| `team-canvas-readiness-backend` | `sha256:a25ed6bbda90b58ecb9633622ab601f2e85643cd32f4bc7049edb53922fa4a82` |
| `team-canvas-readiness-frontend` | `sha256:8450dbdb08fbe42ac32be9fec6edc226245928d324c5a0a54f58ed7b59f7951e` |

Raw logs, Trivy JSON and browser artifacts are local temporary evidence under `/tmp/readiness-*` and the worktree's ignored `test-results/`; they are not committed release artifacts.

## Commit checkpoints

`2dd2380` architecture/backlog; `402135a` safe migrations; `384b848` limits/Helm; `31605f4` privacy/poker; `7153489` templates/sharing; `2366fd5` administration; `4b93e02` recovery/cleanup; `bbfe165` dependencies/CI; `6e3e016` administration/browser/runtime-role verification. The final documentation checkpoint updates ticket checkboxes and records remaining work.
