# Team Canvas user guide

[Back to the README](../README.md) · [Local setup and troubleshooting](local-development.md)

Team Canvas saves shared whiteboards for your team. Sign in through your organization’s SSO, then choose **New canvas** or open an invitation and choose **Accept invitation**. The person who creates a canvas owns it; invited members can edit it.

## Find and organize your work

Use **All canvases**, **My canvases**, or **Shared with me** on the dashboard. Search by canvas name or tags and use sorting to find work. Owners can rename canvases and add up to 20 tags through a canvas’s actions menu. Membership follows your account across browsers and devices.

Inside a canvas, use the drawing tools for shapes, text, and images, or choose **Sticky note**. Other members see your shared edits and cursors in real time. The save indicator shows **Saving**, **Saved**, or **Offline**. Wait for **Saved** before leaving or revealing poker contributions.

Choose **New page** to copy the current page or start blank. A copy can optionally include revealed poker drawings. Any member can add or select a page, and **everyone follows the same selected page**. Page creation and switching are unavailable during poker. Renaming, reordering, and deleting pages are not implemented.

## Invite people and manage access

The owner opens **Share → Create invitation link** and sends the link to colleagues. Recipients must sign in and explicitly accept; an invitation grants editing access. There is no guest or read-only role.

In **Share → Members**, owners can see joined accounts, filter granted or removed memberships, and remove or restore access. Removing a member disconnects their canvas tabs and prevents invitations from bypassing the removal. Restoring access lets them reopen the canvas without another invitation. Saved contributions remain. Account deactivation is shown separately and requires an administrator.

**Revoke invitation links** prevents future joins through those links; existing members retain access. **Remove all member access** also disconnects other members. **Share → Activity** shows the latest 50 access and maintenance changes recorded since the feature was enabled.

Public template visibility is separate from editing membership: even a removed member can copy a public template. Use **Make template private** to stop new copies by other users; existing copies cannot be recalled.

## Run a poker round

Poker is a private contribution-and-reveal workflow for drawings and ideas, not numeric estimation.

1. Any member chooses **Start poker**. Existing shared drawings stay visible and locked.
2. Each participant adds private drawings or images. Other members, including the owner, cannot see those contributions; shared cursors are suppressed.
3. Ask everyone to wait for **Saved**. Any member can choose **Stop poker and reveal**, then confirm with **Reveal saved contributions** to publish the saved work together.

The owner does not need to stay connected, and participants do not need to mark themselves ready. A reveal includes only server-acknowledged changes. Late or unacknowledged edits stay available locally for explicit recovery; they are never automatically published.

Private drafts use a secret held by the browser tab. Refreshing the same tab recovers its draft; another device does not automatically recover it through SSO. Losing the secret prevents personal draft reopening, but another member can still reveal the saved contributions. The server stores no account-to-draft mapping. This does not provide end-to-end encryption: application server and database administrators can access stored content, and text or images can identify their authors.

## Reuse templates

1. Prepare a canvas with the layout and pages you want to reuse.
2. In its dashboard actions menu, choose **Make template**. Keep it private for your own reuse or make it public for all signed-in users of this deployment.
3. Open **Templates** and choose **Start template** to create an independent canvas. Owners can choose **Edit template** to change future copies.

Copies include shared drawings and images across all pages and keep the template’s tags. They exclude private poker drafts, memberships, and invitations. Updating, hiding, or deleting the source does not change existing copies. Ready-made Scrum or architecture templates are not bundled.

## Save and recover work

Acknowledged changes save automatically. Use **Canvas actions → Switch canvas** to open another canvas; navigation protects pending edits and offers draft recovery when needed.

If you see **Offline**, keep the tab open and preserve unsaved work before reloading or signing in again. Use **Download draft** or **Download recovered draft** when offered. A draft download recovers the current page or draft; it is not a complete multi-page backup. A browser crash can lose edits that never reached the server. There is no revision history.

| Problem | What to do |
| --- | --- |
| Access expired | Preserve unsaved work, then sign in again. Ordinary session expiry does not remove membership. |
| Access removed | Ask the owner to restore membership; another invitation cannot bypass removal. |
| Canvas connection limit reached | Close unused canvas tabs or ask your operator about capacity. Extra tabs count as connections. |
| Storage limit reached | Ask the owner to review **Canvas actions → Storage**. |
| Login fails | Contact your deployment operator; for a local instance, see [troubleshooting](local-development.md#troubleshooting). |

Owners can use **Canvas actions → Storage → Clean up storage** while poker is stopped. Cleanup removes deleted drawings and unused images across all pages, preserves visible work, and clears undo history for removed content. Other tabs keep unconfirmed changes for explicit draft export.

## Delete a canvas

Owners can delete a canvas through its dashboard actions menu. Confirmation permanently removes its live contents, invitations, and private drafts for everyone; connected viewers are notified. There is no app undo for deletion. Database backups follow your operator’s retention policy. Canvases are not automatically deleted after inactivity.

## User administration

**User administration** appears only for accounts assigned the Keycloak client role `team-canvas-admin`. Development Alice has this role; Bob does not. App administration does not provide a private-poker inspection API.

| Action | Effect |
| --- | --- |
| Deactivate | Removes access immediately and retains data. Reactivation requires a fresh SSO login. |
| Anonymize | Irreversibly removes identity from the live account and retains owned canvases under a non-login `deleted_user_N` owner. |
| Delete | Permanently removes the account and every owned canvas/template, including shared work, after an impact preview and typed confirmation. Unattributed drawings on other owners’ canvases remain. |
| Reassign | Transfers retained canvases to another owner. |

Offboarding also requires disabling company Keycloak access. Operators must retain current offboarding recovery state and identity-blocking keys separately from database backups; follow the [operations runbook](operations-runbook.md#offboarding) and [production configuration](operator-handover.md#production-configuration).
