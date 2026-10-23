# Initial-development database changes

The schema is consolidated into V1 while this project is in initial development, as agreed with the repository owner. Historical migration compatibility is not provided. Existing databases with old checksums fail validation safely; startup never resets them.

Export or back up anything needed before deliberately recreating **disposable development** data. Never copy test/development volumes into a company deployment. No automatic reset or `flyway repair` is an upgrade procedure. Do not run two backends against one database.

For future retained production data, use forward migrations, a backup and tested restore, one stopped backend, separate migration credentials, and matching frontend/backend protocol versions. See the Helm guide and operations runbook.
