import { useEffect, useId, useState } from "react";
import { getCanvasMembers, setCanvasMemberAccess, type CanvasMember, type TemplateVisibility } from "./api";
import { ConfirmDialog } from "./Dialog";
import { errorMessage } from "./errors";

export function memberReference(member: CanvasMember) {
  return `${member.username ? `@${member.username} · ` : ""}Account ${member.accountId.slice(0, 8)}`;
}

export default function CanvasMembers({ id, busy, setBusy, publicationChanged }: {
  id: string; busy: boolean; setBusy: (busy: boolean) => void;
  publicationChanged: (visibility: TemplateVisibility | null) => void;
}) {
  const headingId = useId();
  const [members, setMembers] = useState<CanvasMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<CanvasMember | null>(null);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (busy) { setMessage(""); return; }
    let abort: AbortController | undefined;
    function load() {
      if (document.visibilityState !== "visible") return;
      abort?.abort();
      const request = new AbortController();
      abort = request;
      setLoading(true);
      void getCanvasMembers(id, request.signal)
        .then(page => {
          if (request.signal.aborted) return;
          setMembers(page.items);
          setIsPublic(page.templateVisibility === "public");
          publicationChanged(page.templateVisibility);
          setLoadError("");
        })
        .catch(error => { if (!request.signal.aborted) setLoadError(errorMessage(error)); })
        .finally(() => { if (!request.signal.aborted) setLoading(false); });
    }
    load();
    const interval = setInterval(load, 10_000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      abort?.abort(); clearInterval(interval);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [id, busy, refresh, publicationChanged]);

  async function changeAccess(member: CanvasMember) {
    setBusy(true);
    setMessage("");
    try {
      await setCanvasMemberAccess(id, member.id, !member.revoked);
      setMessage(`Access ${member.revoked ? "restored" : "removed"} for ${member.displayName}.`);
    } finally { setBusy(false); }
  }
  const visible = members?.filter(member => filter === "all" || (filter === "removed" ? member.revoked : !member.revoked));
  return (
    <section className="canvas-members" aria-labelledby={headingId}>
      <div className="members-heading">
        <h3 id={headingId}>Members</h3>
        <button type="button" className="button" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
      </div>
      <p className="members-help">Members can edit and reveal poker contributions. Removed members need your approval to rejoin.</p>
      <label className="members-filter">Show <select className="field" aria-label="Filter members" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All members</option><option value="granted">Granted access</option><option value="removed">Access removed</option>
      </select></label>
      {loading && members === null && <p role="status">Loading members…</p>}
      {loadError && <div className="error" role="alert">{loadError}{" "}<button type="button" className="button" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>Retry members</button></div>}
      {visible && <ul className="members-list" aria-label="Canvas members">
        {visible.map(member => {
          const referenceId = `${headingId}-${member.id}`;
          return <li key={member.id} className="member-row">
            <div className="member-identity">
              <span className="member-name">{member.displayName}</span>
              <span id={referenceId} className="member-reference" title={member.accountId}>{memberReference(member)}</span>
              <span className="member-status">{member.accountStatus !== "active" ? "Account deactivated · access blocked" : member.role === "owner" ? "Owner" : member.revoked ? "Access removed" : "Can edit"}</span>
            </div>
            {member.role !== "owner" && <button type="button" className="button"
              aria-label={`${member.revoked ? "Restore" : "Remove"} access for ${member.displayName}`} aria-describedby={referenceId}
              disabled={busy || loading || (member.revoked && member.accountStatus !== "active")}
              onClick={() => setSelected(member)}>{member.revoked ? "Restore access" : "Remove access"}</button>}
          </li>;
        })}
      </ul>}
      {members && !members.some(member => member.role === "member") && <p className="members-help">No one else has joined yet.</p>}
      {visible?.length === 0 && <p className="members-help">No members match this filter.</p>}
      {message && <p className="members-help" role="status">{message}</p>}
      {selected && <ConfirmDialog title={selected.revoked ? "Restore member access?" : "Remove member access?"}
        label={selected.revoked ? "Restore access" : "Remove access"} danger={!selected.revoked}
        close={() => setSelected(null)} action={() => changeAccess(selected)}>
        <p><strong>{selected.displayName}</strong><br />{memberReference(selected)}</p>
        <p>{selected.revoked ? "This person can rejoin with a fresh session. Previously revoked sessions stay invalid." : "All their open tabs will be disconnected. Invitation links cannot restore their access. Saved contributions remain."}</p>
        {isPublic && <p className="publication-warning">This canvas is a public template. Every signed-in account, including removed members, can still copy its current shared content. Make the template private to stop future copies.</p>}
      </ConfirmDialog>}
    </section>
  );
}
