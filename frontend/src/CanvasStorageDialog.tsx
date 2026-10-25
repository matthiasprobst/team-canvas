import { useEffect, useState } from "react";
import { compactCanvasStorage, getCanvasStorage, type CanvasStorageUsage } from "./api";
import { ConfirmDialog, Modal } from "./Dialog";
import { errorMessage } from "./errors";

export default function CanvasStorageDialog({ id, close }: { id: string; close: () => void }) {
  const [usage, setUsage] = useState<CanvasStorageUsage | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    void getCanvasStorage(id, abort.signal).then(setUsage).catch(failure => { if (!abort.signal.aborted) setError(errorMessage(failure)); });
    return () => abort.abort();
  }, [id, refresh]);
  return <Modal title="Canvas storage" close={() => { if (!busy) close(); }}>
    <p className="members-help">Clean up deleted drawings and unused images across all pages to recover capacity. Visible content is preserved.</p>
    {usage && <dl className="storage-summary">
      <div><dt>Drawings</dt><dd>{(usage.sceneBytes / 1_000_000).toFixed(1)} / 20 MB</dd></div>
      <div><dt>Images</dt><dd>{(usage.imageBytes / 1_000_000).toFixed(1)} / 128 MB</dd></div>
      <div><dt>Deleted drawings</dt><dd>{usage.deletedElements}</dd></div>
      <div><dt>Unused images</dt><dd>{usage.unusedImages}</dd></div>
    </dl>}
    {usage?.poker && <p className="members-help">Stop poker before cleaning up storage.</p>}
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="members-help" role="status">{message}</p>}
    <div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button><button className="button primary" disabled={!usage || busy || usage.poker || usage.deletedElements + usage.unusedImages === 0} onClick={() => setConfirm(true)}>Clean up storage</button></div>
    {confirm && <ConfirmDialog title="Clean up deleted content?" label="Clean up" close={() => setConfirm(false)} action={async () => {
      setBusy(true);
      try { setUsage(await compactCanvasStorage(id)); setMessage("Storage cleaned up. Deleted drawings can no longer be restored with Undo."); }
      finally { setBusy(false); }
    }}>
      <p>Deleted drawings and unused images will be permanently removed. Undo cannot restore them after cleanup.</p>
      <p>Connected tabs will receive the cleaned canvas. Any unconfirmed changes are kept for draft export.</p>
    </ConfirmDialog>}
  </Modal>;
}
