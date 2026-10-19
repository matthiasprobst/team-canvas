# TC-009: Add intuitive canvas switching without losing work or poker membership

Status: In progress

Dependencies: [TC-003](TC-003-keycloak-authentication-and-sessions.md), [TC-004](TC-004-canvas-dashboard-api.md), [TC-006](TC-006-tailwind-ui-and-routing.md), [TC-007](TC-007-user-dashboard.md), [TC-008](TC-008-sharing-and-invitation-ui.md)

Feature: [User dashboard and Keycloak sign-in](README.md)

## User story

As a participant, I want to move between canvases and my dashboard without losing unsaved work or breaking a collaborative poker round.

## Implementation checklist

- [x] Add Back to canvases and a searchable canvas switcher to the editor header. Offer only authorized canvases and preserve the compact editor workspace.
- [x] Handle dashboard links, switcher selections, browser back/forward, and sign-out through one navigation guard. Wait for pending acknowledgements before leaving.
- [x] When saving is unavailable, offer Stay, Download draft, and explicit Discard and leave. Unexported recovery drafts must also be protected; do not silently discard pending edits or replay them on another canvas.
- [x] Close the old socket and cancel its timers, asset requests, and listeners before connecting the next canvas. Ignore delayed messages from a previous route and release its room slot.
- [x] Warn a not-yet-ready poker participant that leaving keeps them in the round and others must still wait. Navigation does not mark them ready, remove them from the roster, or reveal content.
- [x] Keep saved private drafts and readiness available under the stable membership when reopening the canvas, including from another device. Preserve the existing download and before-unload protections.
- [x] Handle expired/revoked access and a full room without trapping the user in an unusable editor; provide a clear route back to the dashboard.

## Acceptance criteria

- [ ] Users can navigate dashboard → canvas A → canvas B → dashboard with predictable browser history.
- [ ] Pending edits are acknowledged, exported, or explicitly discarded before a route switch; an unavailable save never silently loses work.
- [ ] Only the active canvas has a connection in each tab, and old events/assets cannot update the new canvas.
- [ ] Switching away preserves the frozen poker roster; reopening restores saved drafts/readiness for the same participant.
- [ ] The server reveals only after every roster member is ready, even when members switch canvases or disconnect.
- [ ] Multiple tabs for the same account share one round participant identity but continue to count as separate connections toward the ten-connection limit.

## Validation

Add synchronization/navigation regressions for in-flight acknowledgements, offline edits, recovery exports, stale socket events, room-slot release, and browser navigation. Verify two-user poker privacy and all-ready publication across canvas switches, reconnects, and multiple tabs/devices.

## Completion notes

Added searchable authorized switcher and dashboard links, one router blocker for pending commands/recovery/poker participation, acknowledgement waiting, export/discard choices, socket-close sequencing, asset cancellation, and before-unload protection. Stable membership preserves saved drafts/readiness; navigation does not alter the frozen roster. Sync regressions pass; real multi-browser and transport-failure navigation tests await browser execution.

See [validation evidence and remaining checks](validation.md). Status remains In progress pending runtime acceptance; unchecked criteria are not represented as verified.
