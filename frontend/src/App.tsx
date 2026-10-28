import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Share2, StickyNote } from "lucide-react";
import { Excalidraw, MainMenu, CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { Account, Identity } from "./api";
import AccountMenu from "./AccountMenu";
import { useBoardSession } from "./useBoardSession";
import CanvasSwitcher from "./CanvasSwitcher";
import { Modal, ShareDialog } from "./ui";
import { useBoardNavigation } from "./useBoardNavigation";
import PageControls from "./PageControls";
import CanvasStorageDialog from "./CanvasStorageDialog";
import { ConfirmDialog } from "./Dialog";
import CanvasTimer from "./CanvasTimer";

export default function BoardEditor({ boardId, identity, user }: { boardId: string; identity: Identity; user: Account }) {
  const locationState = useLocation().state as { dashboard?: string } | null;
  const dashboard = locationState?.dashboard?.startsWith("/?") ? locationState.dashboard : "/";
  const {
    view,
    people,
    connections,
    maxConnections,
    deleted,
    editorRef,
    onChange,
    setEditor,
    pointer,
    control,
    timerControl,
    setTimer,
    createPage,
    selectPage,
    recoveryExported,
  } = useBoardSession(boardId, identity);
  const { snapshot, online, error } = view;
  const [switching, setSwitching] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [storage, setStorage] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const sticky = () => {
    const editor = editorRef.current;
    if (!editor || !editable) return;
    const app = editor.getAppState();
    const x = -app.scrollX + 140;
    const y = -app.scrollY + 120;
    const notes = convertToExcalidrawElements([
      {
        type: "rectangle",
        x,
        y,
        width: 220,
        height: 170,
        backgroundColor: "#fff3bf",
        fillStyle: "solid",
        strokeColor: "#b08900",
        label: { text: "Note", fontSize: 22, textAlign: "left", verticalAlign: "top" },
      },
    ]);
    editor.updateScene({
      elements: [...editor.getSceneElementsIncludingDeleted(), ...notes],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const poker = snapshot?.board.mode === "poker";
  const editable = online && !view.busy;
  const isHost = identity.role === "host";
  const { blocker, downloadDraft, waiting } = useBoardNavigation(view, deleted, recoveryExported);
  return (
    <div className="layout">
      {blocker.state === "blocked" && (
        <Modal title="Leave this canvas?" close={() => blocker.reset()}>
          {(view.unsaved || waiting) && (
            <p>
              {online
                ? "Waiting for the server to confirm your changes…"
                : "You are offline. Some changes have not been saved."}
            </p>
          )}
          {!!view.recovery.length && <p>A recovered draft has not been exported.</p>}
          <div className="flex flex-wrap gap-3 mt-5">
            <button className="button" onClick={() => blocker.reset()}>
              Stay here
            </button>
            {view.recovery.length > 0 && (
              <button className="button" onClick={() => downloadDraft(true)}>
                Export recovered draft
              </button>
            )}
            {view.unsaved && !view.recovery.length && (
              <button
                className="button"
                onClick={() => {
                  downloadDraft();
                  blocker.proceed();
                }}
              >
                Export draft and leave
              </button>
            )}
            <button
              className="button"
              onClick={() => {
                if (
                  (!view.unsaved && !view.recovery.length) ||
                  confirm("Discard local unsaved changes and leave? Changes already sent may still be saved.")
                )
                  blocker.proceed();
              }}
            >
              {view.unsaved || view.recovery.length ? "Discard and leave" : "Leave canvas"}
            </button>
          </div>
        </Modal>
      )}
      {switching && <CanvasSwitcher current={boardId} close={() => setSwitching(false)} />}
      {sharing && (
        <ShareDialog id={boardId} name={snapshot?.board.name ?? "canvas"} close={() => setSharing(false)} />
      )}
      {storage && <CanvasStorageDialog id={boardId} close={() => setStorage(false)} />}
      {confirmReveal && <ConfirmDialog title="Stop poker and reveal?" label="Reveal saved contributions" close={() => setConfirmReveal(false)} action={() => control("stop_round")}>
        <p>All saved private contributions will become visible to every member. Wait for Saved before revealing.</p>
      </ConfirmDialog>}
      <header className="editor-navbar">
        <div className="navbar-main">
          <div className="navbar-identity">
            <Link className="canvas-back" to={dashboard} aria-label="Back to canvases">
              <ArrowLeft size={17} />
              <span>Canvases</span>
            </Link>
            <span className="navbar-divider" />
            <div className="canvas-heading">
              <span className="canvas-kicker">TEAM CANVAS</span>
              <strong title={snapshot?.board.name}>{snapshot?.board.name ?? "Board"}</strong>
            </div>
          </div>
          <div className="navbar-actions">
            <span className={`connection-state ${online ? "is-online" : "is-offline"}`}>
              <span className="connection-dot" />
              {online ? (view.unsaved ? "Saving" : "Saved") : "Offline"}
            </span>
            {!online && error && !deleted && (
              <button className="nav-button" onClick={() => location.reload()}>
                Reconnect
              </button>
            )}
            {isHost && !deleted && (
              <button className="nav-button" onClick={() => setSharing(true)}>
                <Share2 size={16} />
                <span>Share</span>
              </button>
            )}
            <details className="canvas-action-menu shell">
              <summary className="nav-button">Canvas actions</summary>
              <div className="canvas-action-items">
                <button className="menu-item" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setSwitching(true); }}>Switch canvas</button>
                {isHost && !deleted && <button className="menu-item" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setStorage(true); }}>Storage</button>}
              </div>
            </details>
          </div>
          <AccountMenu user={user} />
        </div>
        <div className="navbar-workspace">
          <PageControls
            snapshot={snapshot}
            online={online}
            busy={view.busy}
            createPage={createPage}
            selectPage={selectPage}
          />
          <div className="workspace-divider" />
          <div className="canvas-tools">
            {snapshot && <CanvasTimer timer={snapshot.timer} disabled={!online || view.busy || deleted} onAction={timerControl} onSetDuration={setTimer} />}
            {poker && (
              <span className="poker-status">
                <span>●</span> Poker round
              </span>
            )}
            {snapshot?.pokerCreatedIds.length ? (
              <span className="poker-count">{snapshot.pokerCreatedIds.length} poker drawings</span>
            ) : null}
            <button className="nav-button tool-button" aria-label="Sticky note" onClick={sticky} disabled={!editable}>
              <StickyNote size={16} />
              <span>Sticky note</span>
            </button>
            {!poker && (
              <button
                className="primary-action"
                onClick={() => control("start_round")}
                disabled={!online || view.busy}
              >
                Start poker
              </button>
            )}
            {poker && (
              <button className="primary-action" disabled={!online || view.busy} onClick={() => setConfirmReveal(true)}>
                Stop poker and reveal
              </button>
            )}
            {view.recovery.length > 0 && (
              <button className="nav-button" onClick={() => downloadDraft(true)}>
                Download recovered draft
              </button>
            )}
            {!online && view.unsaved && (
              <button className="nav-button" onClick={() => downloadDraft()}>
                Download draft
              </button>
            )}
          </div>
        </div>
      </header>
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      <div className="sidebar">
        <span>
          <b>{people.length}</b> {people.length === 1 ? "person" : "people"} · <b>{connections}{maxConnections === null ? "" : `/${maxConnections}`}</b> connections
        </span>
        {people.map((person) => (
          <span key={person.id} className="pill">
            {person.role === "host" ? "★ " : ""}
            {person.name}
          </span>
        ))}
        {poker && (
          <span className="mini">Your new contributions are private. Any member can stop poker and reveal all saved work.</span>
        )}
        {!poker && (
          <span className="mini">
            Edit shapes, text, and images together. Drag and drop images onto the canvas.
          </span>
        )}
      </div>
      <main className="editor">
        <Excalidraw
          excalidrawAPI={setEditor}
          langCode="en"
          isCollaborating
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          viewModeEnabled={!editable}
          onChange={(elements, _appState, files) => onChange(elements, files)}
          onPointerUpdate={({ pointer: position }) => pointer(position.x, position.y)}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ToggleTheme />
          </MainMenu>
        </Excalidraw>
      </main>
    </div>
  );
}
