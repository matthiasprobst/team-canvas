# TC-007: Implement the personal canvas dashboard

Status: In progress

Dependencies: [TC-003](TC-003-keycloak-authentication-and-sessions.md), [TC-004](TC-004-canvas-dashboard-api.md), [TC-006](TC-006-tailwind-ui-and-routing.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a signed-in user, I want one starting page showing all canvases I own and those shared with me so I can find and open them quickly.

## Implementation checklist

- [x] Load the current account and the authorized canvas list. Render All canvases, My canvases, and Shared with me filters with the selected route/query state reflected in navigation.
- [x] Connect name search, Recently opened / Name sorting, and bounded incremental loading to the server list API. Cancel or ignore stale requests when filters/search change.
- [x] Render metadata cards with title, owner, and the current user’s last-opened time. Use normal links for opening canvases so new-tab navigation remains available; use no canvas thumbnails.
- [x] Implement New canvas with a dialog initially containing Untitled canvas. Validate the 1–120-character name, prevent duplicate submissions, and open the created canvas.
- [x] Implement owner-only Rename from the card menu and update/invalidate the list after success. Show the Share entry for owners; wire it in TC-008.
- [x] Implement loading, empty-owned, empty-shared, no-search-results, and retryable-error states. Failed requests must not masquerade as an empty collection.
- [x] Preserve search, filter, sort, and scroll position when returning from an editor. Refresh membership visibility on dashboard return/window focus and handle revoked access gracefully.

## Acceptance criteria

- [ ] The landing page is the real authenticated dashboard, with no seeded demo canvases in ordinary use.
- [ ] New accounts see a helpful empty state and can create/open a canvas.
- [ ] Owned/shared filters, search, sorting, and loading more results show the authorized server results.
- [ ] Create/rename failures preserve form input and allow retry; nonowners are not offered Rename or invitation creation.
- [ ] Navigating back restores the previous dashboard context.
- [ ] No private poker data or unrelated users’ canvas metadata reaches the dashboard.

## Validation

Use browser checks with two distinct Keycloak accounts. Cover owned/shared results, new users, search races, pagination, create/rename failure recovery, browser navigation, and revoked membership. Verify API authorization independently of hidden UI controls.

## Completion notes

Implemented authorized cards, all/mine/shared filters, server search/sort/pagination, default Untitled canvas creation, rename, loading/empty/error states, stale-request cancellation, focus refresh, and dashboard context restoration. No demo canvases are seeded. Build passes; two-user browser acceptance and scroll/pagination review remain pending.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
