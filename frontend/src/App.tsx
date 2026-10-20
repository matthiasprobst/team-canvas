import { useEffect, useState } from "react";
import { Link, useBlocker, useLocation } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Share2, StickyNote } from "lucide-react";
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { Identity } from "./api";
import { useBoardSession } from "./useBoardSession";
import type { ElementData, Files } from "./protocol";
import CanvasSwitcher from "./CanvasSwitcher";
import { Modal, ShareDialog } from "./ui";

export default function BoardEditor({ boardId, identity }: { boardId: string; identity: Identity }) {
  const locationState = useLocation().state as { dashboard?: string } | null;
  const dashboard = locationState?.dashboard?.startsWith("/?") ? locationState.dashboard : "/";
  const { view, people, deleted, editorRef, onChange, setEditor, pointer, control, createPage, selectPage, recoveryExported } = useBoardSession(boardId, identity);
  const { snapshot, online, error } = view;
  const [switching, setSwitching] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pageDialog, setPageDialog] = useState(false);
  const [copyPageContent, setCopyPageContent] = useState(true);
  const [includePokerContent, setIncludePokerContent] = useState(false);
  const sticky = () => {
    const editor = editorRef.current;
    if (!editor || !editable) return;
    const app = editor.getAppState();
    const x = -app.scrollX + 140;
    const y = -app.scrollY + 120;
    const notes = convertToExcalidrawElements([{
      type: "rectangle", x, y, width: 220, height: 170,
      backgroundColor: "#fff3bf", fillStyle: "solid", strokeColor: "#b08900",
      label: {text: "Note", fontSize: 22, textAlign: "left", verticalAlign: "top"},
    }]);
    editor.updateScene({
      elements: [...editor.getSceneElementsIncludingDeleted(), ...notes],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const round = snapshot?.round;
  const poker = snapshot?.board.mode === "poker";
  const editable = online && !view.busy && (!poker || (!!round?.included && !round.done));
  const isHost = identity.role === "host";
  const downloadDraft = (recovered = false) => {
    const elements = recovered ? view.recovery : view.elements;
    const ids = new Set(elements.filter(element => element.type === "image").map(element => String(element.fileId)));
    const files = Object.fromEntries(Object.entries(view.files).filter(([id]) => ids.has(id)));
    const blob = new Blob([JSON.stringify({ type: "excalidraw", version: 2, source: location.origin,
      elements, files, appState: { viewBackgroundColor: "#ffffff" } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = recovered ? "team-canvas-recovered-draft.excalidraw" : "team-canvas-draft.excalidraw"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (recovered) recoveryExported();
  };

  const unfinished = !deleted && !!round?.included && !round.done;
  const waiting = !deleted && view.busy;
  const blocker = useBlocker(view.unsaved || waiting || view.recovery.length > 0 || unfinished);
  useEffect(() => {
    if (blocker.state === "blocked" && !view.unsaved && !waiting && !view.recovery.length && !unfinished) blocker.proceed();
  }, [blocker, view.unsaved, waiting, view.recovery.length, unfinished]);
  return <div className="layout">
    {blocker.state === "blocked" && <Modal title="Leave this canvas?" close={() => blocker.reset()}>
      {(view.unsaved || waiting) && <p>{online ? "Waiting for the server to confirm your changes…" : "You are offline. Some changes have not been saved."}</p>}
      {!!view.recovery.length && <p>A recovered draft has not been exported.</p>}
      {unfinished && <p>You are not ready in the current poker round. Leaving keeps you in the round; your team will wait until you return and mark yourself ready.</p>}
      <div className="flex flex-wrap gap-3 mt-5"><button className="button" onClick={() => blocker.reset()}>Stay here</button>
        {view.recovery.length > 0 && <button className="button" onClick={() => downloadDraft(true)}>Export recovered draft</button>}
        {view.unsaved && !view.recovery.length && <button className="button" onClick={() => { downloadDraft(); blocker.proceed(); }}>Export draft and leave</button>}
        <button className="button" onClick={() => { if ((!view.unsaved && !view.recovery.length) || confirm("Discard local unsaved changes and leave? Changes already sent may still be saved.")) blocker.proceed(); }}>{view.unsaved || view.recovery.length ? "Discard and leave" : "Leave canvas"}</button>
      </div>
    </Modal>}
    {switching && <CanvasSwitcher current={boardId} close={() => setSwitching(false)} />}
    {sharing && <ShareDialog id={boardId} name={snapshot?.board.name ?? "canvas"} close={() => setSharing(false)} />}
    {pageDialog && <Modal title="Create next page" close={() => setPageDialog(false)}>
      <p className="text-sm text-slate-600">Create a page from the current canvas or start with a blank page.</p>
      <label className="flex gap-2 items-center text-sm mt-4"><input type="checkbox" checked={copyPageContent} onChange={event => setCopyPageContent(event.target.checked)} />Copy current page content</label>
      <label className="flex gap-2 items-center text-sm mt-3"><input type="checkbox" checked={includePokerContent} disabled={!copyPageContent || !snapshot?.pokerCreatedIds.length} onChange={event => setIncludePokerContent(event.target.checked)} />Include drawings created during poker ({snapshot?.pokerCreatedIds.length ?? 0})</label>
      <div className="flex justify-end gap-3 mt-6"><button className="button" onClick={() => setPageDialog(false)}>Cancel</button><button className="button primary" disabled={!online || view.busy || poker} onClick={() => { createPage(copyPageContent, includePokerContent); setPageDialog(false); }}>Create page</button></div>
    </Modal>}
    <header className="editor-navbar">
      <div className="navbar-main">
        <div className="navbar-identity">
          <Link className="canvas-back" to={dashboard} aria-label="Back to canvases"><ArrowLeft size={17} /><span>Canvases</span></Link>
          <span className="navbar-divider" />
          <div className="canvas-heading"><span className="canvas-kicker">TEAM CANVAS</span><strong title={snapshot?.board.name}>{snapshot?.board.name ?? "Board"}</strong></div>
        </div>
        <div className="navbar-actions">
          <span className={`connection-state ${online ? "is-online" : "is-offline"}`}><span className="connection-dot" />{online ? (view.unsaved ? "Saving" : "Saved") : "Offline"}</span>
          {!online && error && !deleted && <button className="nav-button" onClick={() => location.reload()}>Reconnect</button>}
          {isHost && !deleted && <button className="nav-button" onClick={() => setSharing(true)}><Share2 size={16} /><span>Share</span></button>}
          <button className="nav-button switch-canvas" onClick={() => setSwitching(true)}>Switch canvas</button>
          <Link className="signout-link" to="/logout">Sign out</Link>
        </div>
      </div>
      <div className="navbar-workspace">
        <div className="page-tools">
          <span className="page-caption">PAGE</span>
          {snapshot && <div className="page-picker">
            <button className="page-step" aria-label="Previous page" disabled={!online || view.busy || poker || snapshot.pages.findIndex(page => page.id === snapshot.board.pageId) <= 0} onClick={() => {
              const index = snapshot.pages.findIndex(page => page.id === snapshot.board.pageId);
              if (index > 0) selectPage(snapshot.pages[index - 1].id);
            }}><ChevronLeft size={17} /></button>
            <select aria-label="Canvas page" value={snapshot.board.pageId} disabled={!online || view.busy || poker} onChange={event => selectPage(event.target.value)}>
              {snapshot.pages.map((page, index) => <option key={page.id} value={page.id}>Page {index + 1}</option>)}
            </select>
            <span className="page-count">{snapshot.pages.findIndex(page => page.id === snapshot.board.pageId) + 1}<i>/</i>{snapshot.pages.length}</span>
            <button className="page-step" aria-label="Next page" disabled={!online || view.busy || poker || snapshot.pages.findIndex(page => page.id === snapshot.board.pageId) >= snapshot.pages.length - 1} onClick={() => {
              const index = snapshot.pages.findIndex(page => page.id === snapshot.board.pageId);
              if (index < snapshot.pages.length - 1) selectPage(snapshot.pages[index + 1].id);
            }}><ChevronRight size={17} /></button>
          </div>}
          <button className="new-page-button" disabled={!online || view.busy || poker} onClick={() => { setCopyPageContent(true); setIncludePokerContent(false); setPageDialog(true); }}><Plus size={16} /><span>New page</span></button>
        </div>
        <div className="workspace-divider" />
        <div className="canvas-tools">
          {poker && <span className="poker-status"><span>●</span> Poker round</span>}
          {snapshot?.pokerCreatedIds.length ? <span className="poker-count">{snapshot.pokerCreatedIds.length} poker drawings</span> : null}
          <button className="nav-button tool-button" onClick={sticky} disabled={!editable}><StickyNote size={16} /><span>Sticky note</span></button>
          {isHost && !poker && <button className="primary-action" onClick={() => control("start_round")} disabled={!online || view.busy}>Start poker</button>}
          {poker && editable && <button className="primary-action" onClick={() => control("done")}>✓ <span>Ready</span></button>}
          {poker && round?.done && <span className="locked-status">Your contribution is locked</span>}
          {poker && isHost && <button className="nav-button cancel-round" disabled={!online || view.busy} onClick={() => {
            if (confirm("Cancel this round and delete all private contributions?")) control("cancel_round");
          }}>Cancel round</button>}
          {view.recovery.length > 0 && <button className="nav-button" onClick={() => downloadDraft(true)}>Download recovered draft</button>}
          {!online && view.unsaved && <button className="nav-button" onClick={() => downloadDraft()}>Download draft</button>}
        </div>
      </div>
    </header>
    {error && <div className="message" role="alert">{error}</div>}
    <div className="sidebar">
      <span><b>{people.length}/10</b> active</span>
      {people.map(person => <span key={person.id} className="pill">
        {person.role === "host" ? "★ " : ""}{person.name}{poker ? (round?.members.find(member => member.id === person.id)?.done ? " ✓" : " …") : ""}
      </span>)}
      {poker && <span className="mini">Private contributions are visible only to you · automatically revealed when everyone is ready
        {round ? ` · ${round.members.filter(member => member.done).length}/${round.members.length} ready` : ""}
      </span>}
      {poker && round?.members.filter(member => !people.some(person => person.id === member.id)).map(member =>
        <span key={member.id} className="pill">{member.name} · offline{member.done ? " ✓" : " · not ready"}</span>)}
      {!poker && <span className="mini">Edit shapes, text, and images together. Drag and drop images onto the canvas.</span>}
    </div>
    <main className="editor">
      <Excalidraw
        excalidrawAPI={setEditor}
        langCode="en"
        isCollaborating
        viewModeEnabled={!editable}
        onChange={(elements, _appState, files) => onChange(elements as unknown as readonly ElementData[], files as unknown as Files)}
        onPointerUpdate={({ pointer: position }) => pointer(position.x, position.y)}
      />
    </main>
  </div>;
}
