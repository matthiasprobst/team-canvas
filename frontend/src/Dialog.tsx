import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { errorMessage } from "./errors";

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="shell modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

export function ConfirmDialog({ title, children, label, action, close, danger = false }: {
  title: string; children: ReactNode; label: string; action: () => Promise<void> | void; close: () => void; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  async function run() {
    setBusy(true);
    setError("");
    try { await action(); close(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={title} close={() => { if (!busy) close(); }}>
      <div className="dialog-copy">{children}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancel} className="button" disabled={busy} onClick={close}>Cancel</button>
        <button className={`button ${danger ? "danger" : "primary"}`} disabled={busy} onClick={() => void run()}>{busy ? "Please wait…" : label}</button>
      </div>
    </Modal>
  );
}
