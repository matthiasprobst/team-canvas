import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { request, type Account } from "./api";
import { Modal, errorMessage } from "./ui";

type User = { id: string; displayName: string; status: string; ownedCanvases: number };
type Impact = { user: User; canvases: { id: string; name: string }[]; token: string };
type Action = "deactivate" | "reactivate" | "anonymize" | "delete";

export default function Admin() {
  const account = useOutletContext<Account>();
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [action, setAction] = useState<Action>("deactivate");
  const [confirmation, setConfirmation] = useState("");
  const [target, setTarget] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [targets, setTargets] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!account.admin || impact?.user.status !== "placeholder") return;
    const abort = new AbortController();
    void request<{ items: User[] }>(`/api/admin/users?q=${encodeURIComponent(targetQuery)}`, undefined, "GET", abort.signal)
      .then(page => setTargets(page.items.filter(user => user.status === "active")))
      .catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, [account.admin, impact?.user.status, targetQuery]);
  useEffect(() => {
    if (!account.admin) return;
    const abort = new AbortController();
    setError("");
    void request<{ items: User[]; nextOffset: number | null }>(`/api/admin/users?offset=${offset}&q=${encodeURIComponent(query)}`, undefined, "GET", abort.signal)
      .then(page => { setUsers(page.items); setNextOffset(page.nextOffset); })
      .catch(e => { if (!abort.signal.aborted) setError(errorMessage(e)); });
    return () => abort.abort();
  }, [account.admin, offset, query, refresh]);
  if (!account.admin) return <main className="shell p-6"><h1>Administrator access required</h1><Link to="/">Back to canvases</Link></main>;
  async function preview(user: User) {
    setBusy(true); setError(""); setConfirmation(""); setTarget("");
    try { setImpact(await request<Impact>(`/api/admin/users/${user.id}/impact`, undefined, "GET")); setAction(user.status === "deactivated" ? "reactivate" : "deactivate"); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!impact) return;
    setBusy(true); setError("");
    try {
      await request(`/api/admin/users/${impact.user.id}/actions`, { action, impactToken: impact.token, confirmation });
      setNotice(`Account action completed: ${action}. For irreversible offboarding, retain a current offboarding recovery file independently of database backups.`); setImpact(null); setRefresh(n => n + 1);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function reassign(canvas: { id: string; name: string }) {
    if (!target || !confirm(`Assign ${canvas.name} to the selected active account? Existing sessions and invitations will be revoked.`)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/admin/canvases/${canvas.id}/owner`, { targetUserId: target });
      setImpact(null); setNotice("Canvas reassigned. Members can reopen it."); setRefresh(n => n + 1);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const irreversible = action === "delete" || action === "anonymize";
  return <main className="shell max-w-5xl mx-auto p-6">
    <Link className="button" to="/">Back to canvases</Link>
    <a className="button ml-3" href="/api/admin/offboarding-export">Download offboarding recovery file</a>
    <h1 className="text-2xl font-semibold mt-6">User administration</h1>
    <p className="text-slate-600 my-3">Manage application access and retained canvases. Company SSO access is managed in Keycloak.</p>
    {error && !impact && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <label className="block my-4">Search users<input className="field block mt-2" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} /></label>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-3">User</th><th>Status</th><th>Owned canvases</th><th>Actions</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id} className="border-t border-slate-200"><td className="p-3">{user.displayName}</td><td>{user.status}</td><td>{user.ownedCanvases}</td><td><button className="button my-2" disabled={busy || user.id === account.id} onClick={() => void preview(user)}>Manage {user.displayName}</button></td></tr>)}</tbody>
    </table></div>
    {!users.length && <p>No users match this search.</p>}
    <div className="flex gap-3 mt-4"><button className="button" disabled={!offset || busy} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous users</button><button className="button" disabled={nextOffset === null || busy} onClick={() => { if (nextOffset !== null) setOffset(nextOffset); }}>Next users</button></div>
    {impact && <Modal title={`Manage ${impact.user.displayName}`} close={() => { if (!busy) setImpact(null); }}>
      {error && <p className="error" role="alert">{error}</p>}
      <p>{impact.canvases.length} owned canvases, including templates.</p>
      {impact.canvases.length > 0 && <ul className="list-disc pl-5 my-3">{impact.canvases.map(canvas => <li key={canvas.id}>{canvas.name}</li>)}</ul>}
      {impact.user.status === "placeholder" ? <>
        <p>This replacement owner cannot sign in. Its retained canvases remain available to their existing members.</p>
        <label className="block mt-4">Search new owner<input className="field block mt-2" value={targetQuery} onChange={e => { setTargetQuery(e.target.value); setTarget(""); }} /></label>
        <label className="block mt-3">New owner<select className="field block mt-2" value={target} onChange={e => setTarget(e.target.value)}><option value="">Select an active user</option>{targets.map(user => <option key={user.id} value={user.id}>{user.displayName} ({user.id.slice(0, 8)})</option>)}</select></label>
        <p className="text-sm my-2">Search to narrow the first 50 matches. Ownership quotas apply.</p>
        {impact.canvases.map(canvas => <button key={canvas.id} className="button mt-2" disabled={busy || !target} onClick={() => void reassign(canvas)}>Reassign {canvas.name}</button>)}
      </> : <>
        <label className="block mt-4">Account action<select className="field block mt-2" value={action} onChange={e => { setAction(e.target.value as Action); setConfirmation(""); }}>
          {impact.user.status === "active" ? <option value="deactivate">Deactivate access</option> : <option value="reactivate">Reactivate access</option>}
          <option value="anonymize">Anonymize user and retain all owned canvases</option>
          <option value="delete">Delete user and all owned canvases</option>
        </select></label>
        <p className="my-4">{action === "delete" ? "Every owned canvas and template will be permanently removed for all collaborators. Drawings on canvases owned by other users remain." : action === "anonymize" ? "Identity links will be removed. All owned canvases and templates remain under a non-login deleted_user_N owner. Other members keep access." : action === "reactivate" ? "The user must start a fresh SSO login. Revoked sessions are not restored." : "Access stops immediately; existing canvases and account information remain."}</p>
        {irreversible && <><p>This action is irreversible in the live application. Historical backups follow the configured retention policy.</p><label className="block mt-4">Type {action.toUpperCase()} to confirm<input className="field block mt-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label></>}
        <button className="button primary mt-5" disabled={busy || (irreversible && confirmation !== action.toUpperCase())} onClick={() => void apply()}>{busy ? "Applying…" : "Apply account action"}</button>
      </>}
    </Modal>}
  </main>;
}
