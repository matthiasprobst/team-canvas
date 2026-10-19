# TC-008: Add share dialogs and the invitation sign-in journey

Status: In progress

Dependencies: [TC-003](TC-003-keycloak-authentication-and-sessions.md), [TC-005](TC-005-invitation-api.md), [TC-006](TC-006-tailwind-ui-and-routing.md), [TC-007](TC-007-user-dashboard.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As an owner, I want to copy an invitation from the dashboard or editor; as a recipient, I want a clear sign-in and join flow that remembers the shared canvas.

## Implementation checklist

- [x] Wire owner Share actions to a consistent dialog in the dashboard and editor. Generate a link for the public application origin using /b/:id#invite=SECRET; provide copy feedback and a selectable-link fallback when clipboard access is unavailable.
- [x] Preserve a pending invitation in temporary session storage before starting the Keycloak redirect. Remove its fragment from browser history without putting the secret into query parameters, logs, or identity-provider URLs.
- [x] After sign-in, load the authorized invitation preview and show the canvas title/owner with explicit Join canvas and Cancel actions. A public unauthenticated screen must not show protected metadata.
- [x] On acceptance, establish membership, refresh dashboard data, clear the pending invitation, and open the canvas. Existing members can open directly without being registered again.
- [x] Provide clear invalid/revoked-invitation handling with a route back to the dashboard. Clear temporary invitation data on explicit cancellation or terminal invalidation; retain it through a retryable sign-in interruption.
- [x] Ensure sharing from either application surface uses the configured public origin and works in the development WLAN setup. Keep host bulk-revocation controls coherent with the new membership model.

## Acceptance criteria

- [ ] An owner can copy a usable link from either the dashboard or editor.
- [ ] A signed-out recipient can follow the link, sign in, explicitly accept, and find the canvas in Shared with me afterward.
- [ ] The invitation secret never appears in a login redirect URL or unauthenticated metadata response.
- [ ] Repeated acceptance and acceptance by an existing member do not duplicate roster identities or invalidate other tabs.
- [ ] Invalid/revoked invitations show an actionable error without exposing canvas content.
- [ ] Copying remains usable over trusted-WLAN HTTP when the Clipboard API is unavailable.

## Validation

Exercise signed-in and signed-out invitation flows in separate browser sessions, including canceled sign-in, retries, clipboard failure, already-joined users, invalid/revoked links, and configured WLAN URLs.

## Completion notes

Wired owner Share on dashboard and editor, independent links, copy feedback/selectable fallback, fragment-to-session-storage preservation before sign-in, authenticated preview, explicit acceptance, and terminal/cancel cleanup. Added the signed-out recipient journey to browser tests. Real callback and WLAN clipboard validation remain pending.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
