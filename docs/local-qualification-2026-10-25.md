# Local qualification — 2026-10-25

Branch: `production-readiness`. This record qualifies code and local reference images. The receiving company selects its own staging/production platform and accepts its deployment using the [operator handover](operator-handover.md). No company infrastructure was provisioned and no image was published.

## Implemented and reviewed

| Commit | Change |
| --- | --- |
| `00eb23b` | Detect actual writer lock/session loss, latch failure and fail liveness; reserve the real poker completion above the daily quota without allowing unlimited control commands. |
| `7f23fb5` | Optional internal metrics access requiring both namespace and pod selectors; positive/negative Helm checks. |
| `560e653` | Identify admin targets by verified username and full account ID; require account-bound confirmation; add V3 transactional metadata audit with identity erasure and bounded retention. |
| `7ac69cf` | Real isolated dump/restore rehearsal, browser destination checks, independent browser artifact directories and promotion of exact tested image archives without rebuilding. |
| `de118e9` | Platform-independent company handover, optional Helm reference and explicit V3 runtime grants. |
| `52fa594` | Retain complete vulnerability reports and gate those same reports on HIGH/CRITICAL, including unfixed issues. |
| `0d12c65` | Update Alpine/Ubuntu runtime packages and Caddy's Chi dependency after current scans identified available security fixes. |
| `c2ac463` | Batch complete database snapshots in the restore rehearsal, including both audit tables, without dropping assertions. |
| `362714a` | Bound load-test memory/errors/retries, exercise workshop scenes/images and normal session recovery, and provision explicit development-only load fixtures. |
| `70956c4` | Verify populated V2-to-V3 forward migration, complete retained data and audit behavior, idempotence, and checksum rejection without resetting contents. |

Separate development/security/DevOps agents implemented and cross-reviewed these slices. Later load-tool and operator-handover changes received another independent review. The recorded tests below distinguish executed results from remaining company acceptance.

Environment: isolated Compose project `team-canvas-production-readiness`, application `http://localhost:18099`, development Keycloak `http://localhost:18199/auth`, PostgreSQL 17.11 on host port 55440. Local Linux/WSL host used Node 22.15.0/npm 11.6.2 for test harnesses, JDK 21 and Maven 3.8.7 for the recorded host verification; the container build uses the supported Node 24/npm 11.19.1 and Maven 3.9/JDK 21 toolchains. CI specifies the supported toolchain. POSIX/Docker rehearsal helpers are qualified here on Linux, not on every possible developer host.

## Completed checks

- `npm run test:sync --prefix frontend`: all four test files passed.
- Final `mvn -o verify` with PostgreSQL 17.11 at `localhost:55440`: **85 tests, zero failures/errors/skips**, production augmentation passed. This includes the new populated V2-to-V3 upgrade test; all existing table snapshots and checksums survive the upgrade, V3 audit writes/retention work, repeated migration is a no-op, and an intentionally changed V2 checksum refuses migration without resetting content. Full log: `/tmp/team-canvas-production-final-backend.log`; Surefire XML reports: `backend/target/surefire-reports`. An earlier complete run had 84 tests before this additional regression test was introduced.
- Frontend production build: TypeScript/Vite passed, including the account-identification changes; existing large-chunk warning remains.
- Authenticated `tests/smoke.mjs`: public idempotent replay, private drawings/assets/capabilities, member-operated reveal, stale private-write rejection, copied pages/images and ten-connection limit passed.
- One uninterrupted Playwright run: **24 passed**, including desktop/mobile flows, offboarding, local session-expiry recovery and a two-user browser-destination check limited to the application and configured development IdP origins. After runtime security updates, the complete suite passed again: **24 passed in 2.0 minutes**. This check does not cover every editor feature or every deployment-specific destination.
- `tests/recovery.mjs`: actual image migration/export/preparation plus `pg_dump`/`pg_restore` passed again on newly generated disposable databases with the final backend image. Missing-key preparation left complete rows unchanged, including both audit tables; retained drawings/images/pages/private drafts survived; old sessions/invitations were invalidated; repeated preparation was idempotent. Final fixture dump: **44,392 bytes**; full rehearsal **40.629 seconds**, restore/preparation/assertions **26.489 seconds**. This is a small synthetic rehearsal, not a measured company RPO/RTO. Log: `/tmp/team-canvas-production-final-recovery.log`.
- Writer fault injection on the isolated running backend: terminating its advisory-lock database session caused **HTTP 503** on both `/q/health/live` and `/q/health/ready`. After process restart, liveness returned **HTTP 200**. Compose itself does not restart unhealthy processes; the operator must supply supervision on its chosen platform.
- Helm positive/negative selector and immutable-image tests passed. Both final workflows passed Actionlint 1.7.7; Trivy report fixtures confirmed that LOW/MEDIUM pass while unfixed HIGH and CRITICAL secrets fail the separate severity gate.

The first test run's raw `/tmp` browser traces, screenshots and logs were lost in a host restart. Its results were observed before that restart; those first temporary artifacts are not claimed as retained release evidence. The later complete browser rerun uses `/tmp/team-canvas-production-final-browser` and its log `/tmp/team-canvas-production-final-browser.log`. Repeatable commands remain in the repository and CI; local `/tmp` evidence is not durable release storage.

## Local image identities

These are Docker image IDs, not registry manifest digests. Backend/frontend source changes were built and tested together, then their runtime OS/proxy dependencies were patched and requalified. The final frontend's complete `/srv` file digest matches the originally tested frontend exactly: `f658ed6be6c8f0b71a5bf0393ea61f177a450025ad4e5d628a9956fa4d005ac7`. Nonroot/cap-drop Caddy validation and the authenticated protocol smoke passed again on the final images, followed by the full browser rerun.

| Image | Local image ID |
| --- | --- |
| Backend | `sha256:ac6a333e849ae5823e690b826ddafed54218cae86bd1734a14db27b11b946a98` |
| Frontend | `sha256:e307b4d858d2e3e3b1e9e0ee6b6fc4179dd3f855e7314f7aa0051917b0a5fb03` |

## Current security scans

Trivy 0.76.1, current vulnerability databases, `vuln,secret`, all severities, no ignore-unfixed exemption:

| Scope | HIGH / CRITICAL | Other findings | Secrets |
| --- | ---: | --- | ---: |
| Final backend image above | 0 | 27 MEDIUM, 4 LOW | 0 |
| Final frontend image above | 0 | 1 UNKNOWN | 0 |
| Source dependencies | 0 | 1 LOW | 0 |

The initial current scan found a new HIGH `CVE-2026-111497` in Alpine `brotli-libs`, MEDIUM `CVE-2026-114437` in Chi, and an available Ubuntu zlib fix for MEDIUM `CVE-2026-85091`. Runtime upgrades plus the explicit Chi v5.4.0 build replacement removed these findings in the final scans. Both final reports pass `trivy convert --severity HIGH,CRITICAL --exit-code 1`. No available fixed version is reported for the remaining image findings. Their risk disposition is still open; zero HIGH/CRITICAL is not a claim of no vulnerabilities.

The frontend UNKNOWN remains `GO-2026-5932` for unmaintained `golang.org/x/crypto/openpgp`. Module presence does not prove that this package is linked or reachable in Caddy; a candidate-specific package/reachability review is still needed before declaring an exception. No waiver was recorded.

Final runtime CycloneDX SBOMs contain **336 backend components** and **183 frontend components**. Full reports/SBOMs are local `/tmp/team-canvas-*-final-{scan,sbom}.json`; CI retains equivalent reports for release candidates. Source scanning excludes local `.env`, dependency/build directories, `.git` and browser artifacts. Re-scan final published registry digests as described in the release workflow. Periodic fresh builds should use `--pull --no-cache` before qualification: cached Docker package-upgrade layers alone do not discover later patches.

## Isolated load qualification

Target: p95 acknowledgement below 1000ms, with every sent command acknowledged and no command/session errors. Measurements use a fixed-size histogram rounded up to 1ms. No builds, scans, browser suites or recovery rehearsals ran concurrently with these load measurements. Other existing local applications were idle; this is a local-host result, not the receiving company's service-level guarantee.

| Profile | Measured duration | Connections / canvases | Acknowledged writes | p95 / max |
| --- | --- | --- | ---: | --- |
| Capacity, five-second cadence | 60.469s | 200 / 20 | 2,400 / 2,400 sent | 707ms / 800.600ms |
| Workshop, 110ms target cadence, 500 scene elements + image | 60.115s | 10 / 1 | 3,902 / 3,902 sent | 168ms / 334.200ms |
| Session-expiry workshop, 500ms cadence, same scene/image | 330.490s | 10 / 1 | 6,444 / 6,444 sent | 163ms / 717ms |

Capacity achieved 39.69 writes/s, zero errors/backpressure/reconnects/offline ticks, and rejected the overflow socket with 1013. Report: `/tmp/team-canvas-capacity-final.json`. This clean run passes the target that the historical 2026-10-22 run missed.

The fast workshop achieved 64.91 writes/s, all ten image downloads, zero errors/reconnects and 858 backpressure ticks. A tick skips sending while that client already has an unacknowledged batch; it is not a dropped sent command. The achieved rate is below the theoretical 110ms cadence, so this result must not be represented as 90 writes/s. The full-canvas overflow socket closed with 1008 as expected. Report: `/tmp/team-canvas-workshop-final.json`.

The 330-second workshop crossed the normal development Keycloak token expiry without extending token lifetimes or server limits. It recorded **ten successful session refreshes/reconnects and ten original-command retries**, every sent command acknowledged, zero errors, 19.50 writes/s and all ten image downloads. Six offline ticks deferred sends during recovery; cumulative downtime across all ten connections was 4,688.1ms, **not** a 4.7-second simultaneous service outage. There was no ACK backpressure. Report: `/tmp/team-canvas-workshop-soak-final.json`. This qualifies that local expiry/recovery path, not a four-hour soak or a general network-failure guarantee.

## Remaining acceptance scope

A four-hour soak, real slow-reader/reconnect-storm qualification, profiling the rendered editor with near-limit scenes, and representative company-scale upgrade/backup exercises remain distinct checks. The synthetic populated V2-to-V3 test above covers the supplied baseline, not arbitrary older consolidated V1 schemas. CI publication and final image-digest release evidence require an actual successful workflow run; local script/workflow validation does not establish that result.

The company owns actual TLS/CA/proxy configuration, IdP revocation timing, alert delivery, encrypted backup retention, measured RPO/RTO and operating approval on its chosen platform. These are documented acceptance steps for its operators, not a requirement for the code author to provision a company staging environment.

After qualification, only the new `team-canvas-production-readiness` test stack was stopped to release local resources. Its volumes and images were retained; no existing deployment was changed and no production environment was created.
