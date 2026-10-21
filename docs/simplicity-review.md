# Simplicity and company-readiness review

Reviewed 2026-10-21 against the current working tree. This is a source/configuration review, with the local checks recorded below; it does not certify a deployed environment. Recommendations are proposals, not implemented fixes.

The architecture is a reasonable fit for a small internal collaboration tool. Keep the single backend, PostgreSQL, existing editor, and mandatory SSO. The largest obstacles to an easy company change request are safe deployment and upgrades, incomplete interaction between pages and templates, and data lifecycle procedures. A broad rewrite or more collaboration features would make those obstacles harder to resolve.

## Core scope and current fit

| Requirement | Current behavior | Assessment |
| --- | --- | --- |
| Multiple pages | Persistent pages; blank/copy creation; selection shared by all members; page changes blocked during poker | Core workflow exists. Decide whether shared navigation is the intended long-term behavior. |
| Poker | Private drawings/images, fixed roster, readiness barrier, all-ready reveal, owner cancellation | Keep the server rules and regression tests. Disconnected participants can require cancellation. |
| Save and share | PostgreSQL persistence after acknowledgement, durable memberships, authenticated invitations | Fits the core. Sharing grants edit access; recovery export is not a complete canvas backup. |
| Templates | Owner-only or deployment-wide discovery; independent copies of shared content | Only the selected page is copied. Multi-page session templates remain incomplete. No starter layouts are bundled. |
| SSO | Required Keycloak OIDC, issuer/subject identity, login-bound board sessions | Good default. Other providers and immediate external logout are not supported promises. |
| Privacy | Server checks for content/assets, private-round filtering, local fonts, restrictive CSP, hashed invitation/session secrets | Good foundations. Infrastructure administrators remain trusted, and retention/offboarding need procedures. |

## Prioritized findings

### 1. High: the advertised quick start can reset saved data

[docker-compose.yml](../docker-compose.yml) sets `QUARKUS_FLYWAY_VALIDATE_AT_START_CLEAN_ON_VALIDATION_ERROR=true` in the same backend configuration that uses the persistent application database. The file explicitly describes this as a schema reset after validation failure. A migration mismatch can therefore lead to destructive cleanup rather than a failed startup. The previous README emphasized persistent volumes without explaining this setting.

Remove automatic cleanup from the normal startup path; make any developer reset a separate explicit action against disposable data. Add a regression check for non-destructive deployment settings and test upgrades with populated databases. The README now describes the current risk; the configuration itself was not changed by this review.

### 2. High for the requested scope: templates silently omit other pages

[`CanvasCatalog.startTemplate`](../backend/src/main/kotlin/dev/teamcanvas/CanvasCatalog.kt) restricts both element and asset copies to `source.pageId`; the new canvas gets only its initial page. A three-page Scrum template produces a one-page canvas based on whichever page was selected last. Existing template tests exercise a single-page source.

Make template creation copy all source pages in order, including their shared elements and referenced images, while excluding private rounds, memberships, and invitation/session credentials. Cover multi-page isolation and privacy in integration tests. This completes the requested core workflow without introducing another template system.

### 3. High for predictable operations: page growth defeats canvas-level storage expectations

[`CanvasPageService.create`](../backend/src/main/kotlin/dev/teamcanvas/CanvasPageService.kt) has no page-count limit. [`BoardStore.patch`](../backend/src/main/kotlin/dev/teamcanvas/BoardStore.kt) checks element/image/byte budgets for the current page. Repeated copies can keep adding stored content; rate limits slow growth but do not cap it. All page metadata is included in snapshots. The architecture resource table currently labels these budgets as board contents, which overstates the effective bound.

Introduce a modest page limit and an aggregate canvas storage budget, enforcing them on page copies and template copies as well as patches. Align documentation and user-facing errors with the actual scope of each limit. This is a more useful operational safeguard than adding another storage service.

### 4. Medium: SSO and offboarding have a narrower contract than a generic company rollout

[`loginIdentity`](../backend/src/main/kotlin/dev/teamcanvas/Accounts.kt) requires a validated JWT with issuer, subject, expiry, and `sid`. Configuration, development fixtures, and the [deployment guide](../deploy/kubernetes/README.md) target Keycloak. External logout/revocation is bounded by token expiry or subsequent authentication; immediate back-channel logout is absent. Membership and ownership persist independently of IdP access.

Keep Keycloak as the initial supported provider if target companies already operate it. Otherwise validate the required company provider before claiming generic OIDC support. Document the accepted revocation delay. Provide a narrowly scoped, auditable operator procedure for canvases whose owners leave; there is currently no ownership-transfer or account-removal API. A full administration portal is not necessary to address this.

### 5. Medium: privacy needs an explicit data lifecycle and sharing boundary

[`CanvasAccess`](../backend/src/main/kotlin/dev/teamcanvas/CanvasAccess.kt) creates invitations without expiry and revokes links or all shared members together. [`CanvasCatalog`](../backend/src/main/kotlin/dev/teamcanvas/CanvasCatalog.kt) lets any owner publish a template to all admitted users. Independent copies survive source deletion/restriction. These are understandable simple rules, but companies need to know their consequences.

Canvas deletion cascades through live canvas data; it does not erase account/login records or backups. Expired board sessions and command receipts are cleaned opportunistically on user activity, while login records have no cleanup path. See the [account migration](../backend/src/main/resources/db/migration/V3__accounts_and_canvas_membership.sql) and [`BoardRepository`](../backend/src/main/kotlin/dev/teamcanvas/BoardRepository.kt).

Document retention, backup expiry, offboarding, and recovery first, then add bounded cleanup where required. Preserve revoked-login records for as long as old credentials could still be replayed. Decide whether deployment-wide templates and editable invitation links meet the intended audience; add narrower controls only for a demonstrated requirement. Treat private poker drafts as server-readable data, not end-to-end encrypted data.

### 6. Medium: deployment evidence and repeatability need consolidation

The company path requires existing Kubernetes, PostgreSQL, Keycloak, ingress, secret provisioning, and network-policy configuration. That can be simple for a company with those services, but is substantial setup for one without them. The application itself does not require Kubernetes. Choose a primary deployment audience before maintaining another production packaging option.

The [CI workflow](../.github/workflows/verify.yml) defines database tests, container builds, authenticated browser/protocol tests, and image scans. Its presence is not proof of a passing release. The older [validation record](../.features/validation.md) still reports incomplete runtime validation and predates the current pages/templates code. Link release evidence to a commit and refresh that record when the full suite runs.

[Backend containers](../backend/Dockerfile) use Java 25 while CI and developer instructions use Java 21. Frontend containers/CI use Node 24 while instructions say 22+. Standardize the supported build/runtime baseline and test the actual shipped runtime. Prefer immutable release images, a tested populated-database upgrade/restore procedure, and a short configuration reference. Keep the single backend and explicitly accept upgrade downtime instead of adding distributed synchronization.

## Dependencies and maintenance

The frontend manifest has seven direct production entries and six development entries. Two production entries, Tailwind and its Vite plugin, are build tooling and could move to `devDependencies` without a redesign. The lockfile contains 378 resolved package entries, including transitive/platform packages; this is not the number of packages executed in the browser. Do not advertise the dependency tree as tiny based on the seven direct entries.

Excalidraw is a substantial, justified dependency. The local build emits large editor/diagram chunks, including an approximately 1.12 MB minified editor chunk and a 1.82 MB diagram chunk; lazy chunks are not all downloaded on initial navigation. [`AppRouter`](../frontend/src/AppRouter.tsx) already loads the editor lazily. Keep that boundary and the [`EditorAdapter`](../frontend/src/editorAdapter.ts) integration layer. Review exposed editor features against the application's persistence/privacy contract before enabling more; avoid a custom editor or maintained upstream fork just to reduce package counts.

React Router handles actual navigation, Lucide supplies icons, and Tailwind supplies existing styling. Removing them all would incur migration work without addressing the main rollout gaps. Quarkus supplies authentication, HTTP/WebSockets, database access, migrations, health, and metrics; JDBC avoids an additional ORM layer. There is no separate broker, cache, search service, or object store to operate. Keep health/metrics and privacy validation even though they add code.

Add an explicit lockfile/source dependency and license inventory to release evidence. Current CI scans the final images, while the frontend image copies only compiled assets; do not assume that substitutes for reviewing the npm dependency tree. There is no explicit npm dependency scan or SBOM generation step in the workflow. Use existing CI/security tooling where possible rather than adding application services.

The frontend separates transport, reconciliation, editor integration, and React lifecycle; backend services separate access, catalog, pages, rounds, and persistence. These boundaries help keep changes reviewable. Shared protocol fixtures and pure synchronization tests are valuable safeguards. Refactor only where a concrete change exposes duplication or mixed responsibilities. Tags/suggestions are peripheral to the core, so freeze their scope before considering removal; deleting an already integrated feature also costs migration and review effort.

## Decisions to discuss

| Decision | Suggested starting point |
| --- | --- |
| Initial deployment audience | Small internal teams with existing Keycloak and managed PostgreSQL; use the Kubernetes template where the company already operates Kubernetes. |
| Capacity and availability | Keep ten connections per canvas and one backend; measure supported load and accept planned upgrade downtime. |
| Page workflow | Keep shared session navigation for now; complete multi-page template copies before adding page-management conveniences. |
| Template content | Small maintained example layouts for Scrum/architecture work, rather than a template marketplace or another rendering engine. |
| Sharing boundary | Explicitly accept deployment-wide template publication and editing memberships, or identify a concrete need for narrower access. |
| Retention and ownership | Decide who handles departed owners, how long data/backups remain, and the required recovery time/data-loss tolerance. |
| Save/export promise | Automatic server persistence is core; decide whether portable export/import of an entire canvas is also required. |

A change request should state the core workflow improved, services/dependencies added or removed, permission/data effects, migration and recovery behavior, and relevant verification. Prefer one bounded behavior change per request. New integrations or administrative features should require a real use case rather than anticipated demand.

## Verification for this review

- `npm run test:sync --prefix frontend` passed for the four synchronization/protocol/draft test modules.
- `npm run build --prefix frontend` passed type-checking and the production build, with large-chunk warnings.
- `mvn -o test` passed using cached dependencies: 38 tests executed successfully; 17 PostgreSQL integration tests were skipped because `TEAM_CANVAS_TEST_JDBC_URL` was not configured. The first attempt was blocked by sandbox restrictions on Kotlin's compiler cache; the authorized rerun succeeded. The local toolchain was JDK 21 and Maven 3.8.7, below the documented Maven 3.9+ baseline, so this is not validation of that supported build environment.
- Documentation whitespace and relative file links were checked. No deployment was started or modified.

No application behavior or deployment configuration was changed. Existing working-tree changes to `AGENTS.md`, `SingleWriterGuard.kt`, its test, and `docs/architecture.md` were left intact. Full authenticated browser/smoke journeys and company-environment verification were not run for this documentation review.
