# Compact documentation plan

## Goal

Help a new user sign in, create or join a canvas, collaborate, and find help without reading deployment or implementation details. Keep a small set of task-focused Markdown guides in the repository; no documentation generator is needed.

## Reading paths and page budgets

Budgets are editorial targets, not reasons to remove recovery or data-loss instructions. The README is the navigation entry point; avoid a second index that repeats it.

| Page | Audience and contents | Target |
| --- | --- | --- |
| [README](../README.md) | New users: purpose, first canvas, local demo, links by task | Under 100 lines |
| [User guide](user-guide.md) | Participants and owners: pages, sharing, poker, templates, saving/recovery; brief admin actions | Under 1,200 words |
| [Local development](local-development.md) | Contributors: Compose, demo accounts, WLAN, local processes, tests, troubleshooting | Under 1,500 words |
| [Operator handover](operator-handover.md) | Deployment owners: runtime contract, production configuration, platform choices | Under 1,000 words |
| [Operations runbook](operations-runbook.md) and [upgrade notes](upgrading.md) | Operators: procedures plus version-specific changes | One home per procedure; retain complete recovery commands |
| [Architecture](architecture.md) and [security model](security-model.md) | Maintainers: implementation, protocol, limits, permission boundaries | Reference detail, linked from the relevant task |

Keep [production readiness](production-readiness.md) as the release gate checklist. Dated qualification reports, `.features/` tickets, the company-readiness plan, and the simplicity review remain evidence or historical context, rather than onboarding prerequisites. Helm and Kubernetes instructions stay alongside their deployment files.

## Delivery sequence

1. **Entry point and relocation — completed in this change.** Rewrite the README around first use; move detailed workflows into the user guide and local commands into the development guide. Preserve product scope in architecture. Link existing operator references, correct the stale architecture connection limit, and update references to moved instructions.
2. **User walkthrough — planned.** Validate the guide in two browser profiles: create/invite/accept, shared page switching, private contributions and reveal, template copies, member removal, and draft recovery. Check exact labels and what each role can do. Add at most two annotated screenshots from disposable sample data if they make navigation clearer; record how to reproduce them.
3. **Reference consolidation — planned.** Review handover, runbook, architecture, and security for repeated or stale claims. Keep configuration in handover, operational commands in the runbook, migration changes in upgrade notes, protocol limits in architecture, and permission guarantees in security. Replace duplicates with links. Clearly distinguish current behavior, targets, and dated test evidence; preserve historical reports as dated records.
4. **Maintenance checks — planned.** Add a lightweight relative-link/anchor check to CI and a documentation reminder to change reviews. Update the relevant guide whenever UI labels, permissions, configuration, migration steps, or recovery behavior change. Validate setup commands on a fresh disposable stack when they change.

## Acceptance criteria

- A new user can find the sign-in/create/invite path in the first screen of the README and a relevant guide in one click.
- The guide explains who can edit, who can reveal poker contributions, what “public template” means, and what **Saved** guarantees.
- Local demo credentials and destructive volume commands are clearly scoped to development. Production instructions remain reachable without presenting the demo as production-ready.
- No unique setup, recovery, privacy, or deletion information is lost when shortening pages. Commands specify their working directory and required environment.
- Relative links and anchors resolve; UI terms match the implementation. Documentation-only changes require these checks, not a full application test run.
- Browser walkthroughs and fresh-stack checks are reported separately from static documentation review; planned checks are not presented as passed.
