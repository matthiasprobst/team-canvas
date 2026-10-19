import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, Link as LinkIcon, Copy } from "lucide-react";
import { createInvitation, getTagSuggestions, revokeInvitations, type TemplateVisibility } from "./api";

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="shell modal" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }}>
    <div className="flex items-center justify-between gap-4 mb-5"><h2 id={titleId} className="text-xl font-semibold">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}
export function NameDialog({ initial = "", title, submitLabel = title, action, close }: { initial?: string; title: string; submitLabel?: string; action: (name: string) => Promise<void>; close: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={title} close={() => { if (!busy) close(); }}><form onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); void action(name.trim()).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); }}>
    <label className="block text-sm font-medium mb-2" htmlFor="canvas-name">Canvas name</label>
    <input autoFocus id="canvas-name" className="field w-full" value={name} maxLength={120} required onChange={e => setName(e.target.value)} placeholder="e.g. Sprint planning" />
    {error && <p className="error" role="alert">{error}</p>}
    <div className="flex justify-end gap-3 mt-6"><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : submitLabel}</button></div>
  </form></Modal>;
}
export function DeleteCanvasDialog({ name, action, close }: { name: string; action: () => Promise<void>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  async function remove() {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title="Delete canvas?" close={() => { if (!busy) close(); }}>
    <p className="text-sm text-slate-600 break-words">Permanently delete <strong>{name}</strong> and all its contents? This removes the canvas for everyone, including any active poker round. This cannot be undone.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="flex justify-end gap-3 mt-6"><button ref={cancelRef} className="button" disabled={busy} onClick={close}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete canvas"}</button></div>
  </Modal>;
}

export function TemplateDialog({ name, visibility, close, save, remove }: {
  name: string;
  visibility: TemplateVisibility | null;
  close: () => void;
  save: (visibility: TemplateVisibility) => Promise<void>;
  remove: (() => Promise<void>) | null;
}) {
  const [selected, setSelected] = useState<TemplateVisibility>(visibility ?? "private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const title = visibility ? "Template settings" : "Make this a template";
  return <Modal title={title} close={() => { if (!busy) close(); }}>
    <p className="text-sm text-slate-600 mb-4">Create independent canvases from <strong>{name}</strong>. Existing copies will not change when you edit this canvas.</p>
    <label className="block text-sm font-medium mb-2" htmlFor="template-visibility">Who can find and start this template?</label>
    <select id="template-visibility" className="field w-full" value={selected} disabled={busy} onChange={event => setSelected(event.target.value as TemplateVisibility)}>
      <option value="private">Private · only you</option>
      <option value="public">Public · anyone signed in</option>
    </select>
    {selected === "public" && <p className="text-sm text-slate-600 mt-3">Everyone signed in to Team Canvas can find and copy its shared drawings and images.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="flex flex-wrap justify-between gap-3 mt-6">
      {remove && <button className="button text-red-700" disabled={busy} onClick={() => void run(remove)}>Remove template</button>}
      <div className="flex justify-end gap-3 ml-auto"><button className="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy} onClick={() => void run(() => save(selected))}>{busy ? "Saving…" : "Save settings"}</button></div>
    </div>
  </Modal>;
}

export function TagDialog({ name, initial, close, save }: {
  name: string;
  initial: string[];
  close: () => void;
  save: (tags: string[]) => Promise<void>;
}) {
  const [tags, setTags] = useState(initial);
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void getTagSuggestions().then(setSuggestions).catch(() => setSuggestions([])); }, []);

  const normalized = value.trim().toLowerCase();
  const add = (candidate = value) => {
    const tag = candidate.trim();
    if (!tag || tag.length > 40 || tag.split("").some(char => /[\u0000-\u001f\u007f-\u009f]/.test(char)) || tags.length >= 20 || tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) return;
    setTags(current => [...current, tag]);
    setValue("");
    setError("");
  };
  const available = suggestions.filter(tag => tag.toLowerCase().includes(normalized) && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())).slice(0, 8);
  async function commit() {
    setBusy(true); setError("");
    try { await save(tags); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return <Modal title="Manage tags" close={() => { if (!busy) close(); }}>
    <p className="text-sm text-slate-600 mb-4">Add tags to <strong>{name}</strong> so you and everyone who can see the canvas can find it.</p>
    <div className="flex flex-wrap gap-2 mb-4" aria-label="Selected tags">
      {tags.map(tag => <span key={tag.toLowerCase()} className="tag-chip">{tag}<button type="button" aria-label={`Remove ${tag}`} disabled={busy} onClick={() => setTags(current => current.filter(item => item.toLowerCase() !== tag.toLowerCase()))}>×</button></span>)}
      {tags.length === 0 && <span className="text-sm text-slate-500">No tags yet</span>}
    </div>
    <form onSubmit={event => { event.preventDefault(); add(); }}>
      <label className="block text-sm font-medium mb-2" htmlFor="canvas-tag">Add a tag</label>
      <div className="flex gap-2"><input autoFocus id="canvas-tag" className="field min-w-0 flex-1" value={value} maxLength={40} disabled={busy || tags.length >= 20} onChange={event => setValue(event.target.value)} placeholder="e.g. planning" /><button className="button" disabled={busy || !value.trim() || tags.length >= 20}>Add tag</button></div>
    </form>
    {available.length > 0 && <div className="mt-3"><p className="text-xs text-slate-500 mb-2">Suggestions</p><div className="flex flex-wrap gap-2">{available.map(tag => <button key={tag} className="tag-suggestion" disabled={busy || tags.length >= 20} onClick={() => add(tag)}>{tag}</button>)}</div></div>}
    <p className="text-xs text-slate-500 mt-3">Up to 20 tags, 40 characters each. Matching ignores capitalization.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="flex justify-end gap-3 mt-6"><button className="button" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy} onClick={() => void commit()}>{busy ? "Saving…" : "Save tags"}</button></div>
  </Modal>;
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
