import { useEffect, useId, useState } from "react";
import { Copy, Link as LinkIcon } from "lucide-react";
import { createInvitation, getAccessHistory, revokeInvitations, setTemplateVisibility, type AccessEvent, type TemplateVisibility } from "./api";
import CanvasMembers from "./CanvasMembers";
import { ConfirmDialog, Modal } from "./Dialog";
import { errorMessage } from "./errors";

function AccessHistory({ id }: { id: string }) {
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void getAccessHistory(id, abort.signal).then(setEvents).catch(failure => { if (!abort.signal.aborted) setError(errorMessage(failure)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [id]);
  const labels: Record<string, string> = { member_removed: "Removed member access", member_restored: "Restored member access", invitations_revoked: "Revoked invitation links", template_published: "Published template", template_private: "Made template private", template_unpublished: "Removed template publication", storage_cleaned: "Cleaned up storage" };
  return <section aria-label="Access activity">
    <p className="members-help">The latest 50 access and maintenance changes. History starts when this feature was enabled.</p>
    {loading && <p role="status">Loading activity…</p>}{error && <p className="error" role="alert">{error}</p>}
    <ol className="access-history">{events.map(event => <li key={event.id}>
      <strong>{labels[event.action] ?? event.action}</strong>
      {event.targetName && <span>{event.targetName} · Account {event.targetId?.slice(0, 8)}</span>}
      <span>{event.actorName ?? "Deleted account"} · {new Date(event.createdAt).toLocaleString()}</span>
    </li>)}</ol>
    {!loading && !error && !events.length && <p className="members-help">No changes recorded yet.</p>}
  </section>;
}

export default function ShareDialog({ id, name, close }: { id: string; name: string; close: () => void }) {
  const [tab, setTab] = useState("members");
  const tabsId = useId();
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [visibility, setVisibility] = useState<TemplateVisibility | null>(null);
  const [confirmation, setConfirmation] = useState<"links" | "members" | "private" | null>(null);
  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await createInvitation(id);
      setExpiresAt(result.expiresAt);
      setLink(`${location.origin}/b/${id}#invite=${encodeURIComponent(result.inviteKey)}`);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function confirmChange() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (confirmation === "private") {
        await setTemplateVisibility(id, "private"); setVisibility("private"); setMessage("Template is now private. Existing copies remain independent.");
      } else {
        await revokeInvitations(id, confirmation === "members"); setLink(""); setMessage(confirmation === "members" ? "Invitations revoked and member access removed." : "Invitations revoked. Existing members keep access.");
      }
    } finally { setBusy(false); }
  }
  return <Modal title={`Share ${name}`} close={() => { if (!busy) close(); }}>
    {visibility === "public" && <div className="publication-warning" role="status">
      <strong>Public template</strong><p>Every signed-in user can copy the current shared content, including removed members. Existing copies cannot be recalled.</p>
      <button className="button" disabled={busy} onClick={() => setConfirmation("private")}>Make template private</button>
    </div>}
    <nav className="dialog-tabs" aria-label="Sharing sections">{[["members", "Members"], ["links", "Invitation links"], ["activity", "Activity"]].map(([value, label]) =>
      <button key={value} id={`${tabsId}-${value}-tab`} className="button" aria-current={tab === value ? "page" : undefined} aria-controls={`${tabsId}-${value}`} onClick={() => setTab(value)}>{label}</button>
    )}</nav>
    <div hidden={tab !== "members"} id={`${tabsId}-members`} aria-labelledby={`${tabsId}-members-tab`}>
      <CanvasMembers id={id} busy={busy} setBusy={setBusy} publicationChanged={setVisibility} />
      <div className="share-danger-zone"><button className="button text-red-700" disabled={busy} onClick={() => setConfirmation("members")}>Remove all members and revoke links</button></div>
    </div>
    <section hidden={tab !== "links"} id={`${tabsId}-links`} aria-labelledby={`${tabsId}-links-tab`}>
      <p className="members-help">Anyone with a link can sign in and accept editing access. Members can start poker and reveal all saved contributions.</p>
      <button className="button primary" disabled={busy} onClick={() => void generate()}><LinkIcon size={16} />{link ? "Create another link" : "Create invitation link"}</button>
      {link && <div className="mt-4">
        <label className="text-sm block mb-2" htmlFor="share-link">Invitation link</label>
        <input id="share-link" className="field w-full" readOnly value={link} onFocus={event => event.target.select()} />
        <button className="button mt-3" onClick={() => {
          if (!navigator.clipboard) { setMessage("Select and copy the link above."); return; }
          void navigator.clipboard.writeText(link).then(() => setMessage("Link copied.")).catch(() => setMessage("Select and copy the link above."));
        }}><Copy size={16} />Copy link</button>
        <p className="members-help">Expires {new Date(expiresAt).toLocaleString()}. Earlier links work until they expire or are revoked.</p>
      </div>}
      <div className="share-danger-zone"><button className="button text-red-700" disabled={busy} onClick={() => setConfirmation("links")}>Revoke invitation links</button></div>
    </section>
    {tab === "activity" && <div id={`${tabsId}-activity`} aria-labelledby={`${tabsId}-activity-tab`}><AccessHistory id={id} /></div>}
    {message && <p className="members-help" role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
    {confirmation && <ConfirmDialog title={confirmation === "private" ? "Make template private?" : confirmation === "members" ? "Remove all member access?" : "Revoke invitation links?"}
      label={confirmation === "private" ? "Make private" : confirmation === "members" ? "Remove all members" : "Revoke links"} danger={confirmation !== "private"}
      close={() => setConfirmation(null)} action={confirmChange}>
      <p>{confirmation === "private" ? "Only you will be able to start new copies of this template. Existing canvas memberships stay in place, and existing copies remain available to their owners." : confirmation === "members" ? "All invitation links will be revoked and all other members disconnected. They cannot rejoin until you restore their access. Saved contributions remain." : "All invitation links will stop working. Existing members keep their editing access."}</p>
      {visibility === "public" && confirmation === "members" && <p className="publication-warning">Public template copies remain available to every signed-in user until you make this template private.</p>}
    </ConfirmDialog>}
  </Modal>;
}
