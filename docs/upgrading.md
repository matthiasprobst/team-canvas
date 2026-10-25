# Initial-development database changes

The initial-development schema was consolidated into V1, as agreed with the repository owner. Databases created from the current V1 baseline can now apply forward migrations. Databases with older consolidated V1 checksums still fail validation safely; startup never resets them.

V2 adds optional verified SSO usernames and canvas access history without changing existing memberships or drawing data. Usernames populate on the next authenticated account check. Older actions have no fabricated history. Stop the backend, back up retained data, and run the standalone `backend migrate` command using migration credentials before starting the matching application images. Ensure runtime grants and default privileges include the new `canvas_access_events` table and its identity sequence.

V3 adds `admin_audit_events` and its identity sequence. Grant the runtime role SELECT/INSERT/UPDATE/DELETE on the new table and USAGE/SELECT on its sequence after migration (or use equivalent migration-owner default privileges). The periodic cleanup needs DELETE access. Irreversible admin requests now require `DELETE <full-account-UUID>` or `ANONYMIZE <full-account-UUID>`; deploy matching frontend and backend versions. Existing audit history is not fabricated. Erasing an account removes its references from historical events, and the application exposes only the latest 100 events within 90 days. See the runbook for retention and external audit limitations.

Export or back up anything needed before deliberately recreating **disposable development** data. Never copy test/development volumes into a company deployment. No automatic reset or `flyway repair` is an upgrade procedure. Do not run two backends against one database.

For future retained production data, use forward migrations, a backup and tested restore, one stopped backend, separate migration credentials, and matching frontend/backend protocol versions. See the operator handover and operations runbook; Helm is an optional Kubernetes example.
