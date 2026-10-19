import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, Link as LinkIcon, Copy } from "lucide-react";
import { createInvitation, revokeInvitations } from "./api";

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="shell modal" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }}>
    <div className="flex items-center justify-between gap-4 mb-5"><h2 id={titleId} className="text-xl font-semibold">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}
export function NameDialog({ initial = "", title, action, close }: { initial?: string; title: string; action: (name: string) => Promise<void>; close: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={title} close={() => { if (!busy) close(); }}><form onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); void action(name.trim()).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); }}>
    <label className="block text-sm font-medium mb-2" htmlFor="canvas-name">Canvas name</label>
    <input autoFocus id="canvas-name" className="field w-full" value={name} maxLength={120} required onChange={e => setName(e.target.value)} placeholder="e.g. Sprint planning" />
    {error && <p className="error" role="alert">{error}</p>}
    <div className="flex justify-end gap-3 mt-6"><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : title}</button></div>
  </form></Modal>;
}
export function ShareDialog({ id, name, close }: { id: string; name: string; close: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revokeMembers, setRevokeMembers] = useState(false);
  async function generate() {
    setBusy(true); setError(""); setMessage("");
    try { const result = await createInvitation(id); setLink(`${location.origin}/b/${id}#invite=${encodeURIComponent(result.inviteKey)}`); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title={`Share ${name}`} close={() => { if (!busy) close(); }}>
    <p className="text-sm text-slate-600 mb-5">Anyone with an invitation can sign in and accept it. Accepted canvases appear in their dashboard.</p>
    <button className="button primary" disabled={busy} onClick={() => void generate()}><LinkIcon size={16} />{link ? "Create another link" : "Create invitation link"}</button>
    {link && <div className="mt-4"><label className="text-sm block mb-2" htmlFor="share-link">Invitation link</label><input id="share-link" className="field w-full" readOnly value={link} onFocus={e => e.target.select()} />
      <button className="button mt-3" onClick={() => {
        if (!navigator.clipboard) { setMessage("Select and copy the link above."); return; }
        void navigator.clipboard.writeText(link).then(() => setMessage("Link copied.")).catch(() => setMessage("Select and copy the link above."));
      }}><Copy size={16} />Copy link</button>
      <p className="text-xs text-slate-500 mt-3">Earlier links continue to work until you revoke invitations.</p></div>}
    <div className="border-t border-slate-200 mt-6 pt-5"><label className="flex gap-2 text-sm"><input type="checkbox" checked={revokeMembers} onChange={e => setRevokeMembers(e.target.checked)} />Also remove access for existing members</label>
      <button className="button mt-3 text-red-700" disabled={busy} onClick={() => {
        if (!confirm(revokeMembers ? "Revoke all invitation links and remove all shared members? Frozen poker participants remain in the round." : "Revoke all invitation links? Existing members will keep access.")) return;
        setBusy(true); setError(""); void revokeInvitations(id, revokeMembers).then(() => { setLink(""); setMessage("Invitations revoked."); }).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
      }}>Revoke invitations</button></div>
    {message && <p className="text-sm mt-4" role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
  </Modal>;
}
