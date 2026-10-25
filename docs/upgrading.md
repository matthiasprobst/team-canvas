# Initial-development database changes

The initial-development schema was consolidated into V1, as agreed with the repository owner. Databases created from the current V1 baseline can now apply forward migrations. Databases with older consolidated V1 checksums still fail validation safely; startup never resets them.

V2 adds optional verified SSO usernames and canvas access history without changing existing memberships or drawing data. Usernames populate on the next authenticated account check. Older actions have no fabricated history. Stop the backend, back up retained data, and run the standalone `backend migrate` command using migration credentials before starting the matching application images. Ensure runtime grants and default privileges include the new `canvas_access_events` table and its identity sequence.

Export or back up anything needed before deliberately recreating **disposable development** data. Never copy test/development volumes into a company deployment. No automatic reset or `flyway repair` is an upgrade procedure. Do not run two backends against one database.

For future retained production data, use forward migrations, a backup and tested restore, one stopped backend, separate migration credentials, and matching frontend/backend protocol versions. See the Helm guide and operations runbook.
