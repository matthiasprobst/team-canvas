import { useEffect, useState } from "react";
import { Link, useBlocker, useLocation } from "react-router-dom";
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements, sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { Identity } from "./api";
import { useBoardSession } from "./useBoardSession";
import type { ElementData, Files } from "./protocol";
import type { AvatarMarker } from "./protocol";
import CanvasSwitcher from "./CanvasSwitcher";
import { Modal, ShareDialog } from "./ui";
import AvatarView from "./AvatarView";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type BoardViewport = {
  scrollX: number;
  scrollY: number;
  zoom: ReturnType<ExcalidrawImperativeAPI["getAppState"]>["zoom"];
};

export default function BoardEditor({ boardId, identity }: { boardId: string; identity: Identity }) {
  const locationState = useLocation().state as { dashboard?: string } | null;
  const dashboard = locationState?.dashboard?.startsWith("/?") ? locationState.dashboard : "/";
  const { view, people, avatars, deleted, editorRef, onChange, setEditor, pointer, control, avatarAction, recoveryExported } = useBoardSession(boardId, identity);
  const { snapshot, online, error } = view;
  const [switching, setSwitching] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [placingAvatar, setPlacingAvatar] = useState(false);
  const [viewport, setViewport] = useState<BoardViewport>({ scrollX: 0, scrollY: 0, zoom: { value: 1 as BoardViewport["zoom"]["value"] } });
  const [drag, setDrag] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
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
  const avatarPosition = (marker: AvatarMarker, clientX = 0, clientY = 0, dragging = false) => {
    const app = editorRef.current?.getAppState();
    const state = app ?? { offsetLeft: 0, offsetTop: 0 };
    const point = dragging
      ? viewportCoordsToSceneCoords({ clientX, clientY }, { ...viewport, offsetLeft: state.offsetLeft, offsetTop: state.offsetTop })
      : { x: marker.x, y: marker.y };
    const screen = sceneCoordsToViewportCoords({ sceneX: point.x, sceneY: point.y }, { ...viewport, offsetLeft: state.offsetLeft, offsetTop: state.offsetTop });
    const bounds = document.querySelector(".editor")?.getBoundingClientRect();
    return { left: screen.x - (bounds?.left ?? 0), top: screen.y - (bounds?.top ?? 0) };
  };
  const placeAvatar = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!placingAvatar || !editable || !editorRef.current) return;
    const app = editorRef.current.getAppState();
    const scene = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, {
      zoom: app.zoom, offsetLeft: app.offsetLeft, offsetTop: app.offsetTop, scrollX: app.scrollX, scrollY: app.scrollY,
    });
    avatarAction("avatar_place", scene);
    setPlacingAvatar(false);
  };
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
    <header className="topbar">
      <Link className="back-link" to={dashboard}>← Canvases</Link>
      <button onClick={() => setSwitching(true)}>Switch canvas</button>
      <strong>{snapshot?.board.name ?? "Board"}</strong>
      <span className={`pill ${online ? "" : "offline"}`}>{online ? (view.unsaved ? "● Saving…" : "● Saved") : "○ Offline"}</span>
      {poker && <span className="pill poker">🔒 Poker round</span>}
      <div className="spacer" />
      <button onClick={sticky} disabled={!editable}>＋ Sticky note</button>
      {!poker && <button onClick={() => setPlacingAvatar(value => !value)} disabled={!editable} aria-pressed={placingAvatar}>{placingAvatar ? "Click canvas to place…" : "Place my avatar"}</button>}
      {isHost && !deleted && <button onClick={() => setSharing(true)}>Share</button>}
      <Link className="back-link" to="/logout">Sign out</Link>
      {!online && error && !deleted && <button onClick={() => {
        location.reload();
      }}>Rejoin</button>}
      {isHost && !poker && <button className="primary" onClick={() => control("start_round")} disabled={!online || view.busy}>Start poker</button>}
      {poker && editable && <button className="primary" onClick={() => control("done")}>✓ Ready</button>}
      {poker && round?.done && <span className="pill">Your contribution is locked</span>}
      {poker && isHost && <button disabled={!online || view.busy} onClick={() => {
        if (confirm("Cancel this round and delete all private contributions?")) control("cancel_round");
      }}>Cancel round</button>}

      {view.recovery.length > 0 && <button onClick={() => downloadDraft(true)}>Download recovered draft</button>}
      {!online && view.unsaved && <button onClick={() => downloadDraft()}>Download draft</button>}
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
    <main className={"editor " + (placingAvatar ? "placing-avatar" : "")} onClick={placeAvatar}>
      <Excalidraw
        excalidrawAPI={setEditor}
        langCode="en"
        isCollaborating
        viewModeEnabled={!editable}
        onChange={(elements, _appState, files) => onChange(elements as unknown as readonly ElementData[], files as unknown as Files)}
        onPointerUpdate={({ pointer: position }) => pointer(position.x, position.y)}
        onScrollChange={(scrollX, scrollY, zoom) => setViewport({ scrollX, scrollY, zoom })}
      />
      {!poker && <div className="avatar-layer" aria-label="Canvas avatars">
        {avatars.map(marker => {
          const position = avatarPosition(marker, drag?.clientX, drag?.clientY, drag?.id === marker.id);
          const size = Math.max(24, Math.min(64, 44 * viewport.zoom.value));
          return <div key={marker.id} className="canvas-avatar" style={{ left: position.left, top: position.top, width: size, height: size }}>
            <button className="canvas-avatar-drag" aria-label={marker.name + "'s avatar; drag to move"} onClick={event => event.stopPropagation()}
              onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: marker.id, clientX: event.clientX, clientY: event.clientY }); }}
              onPointerMove={event => { if (drag?.id === marker.id) setDrag({ id: marker.id, clientX: event.clientX, clientY: event.clientY }); }}
              onPointerUp={event => {
                if (drag?.id !== marker.id) return;
                event.stopPropagation();
                const app = editorRef.current?.getAppState();
                if (app) {
                  const scene = viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, { zoom: app.zoom, offsetLeft: app.offsetLeft, offsetTop: app.offsetTop, scrollX: app.scrollX, scrollY: app.scrollY });
                  avatarAction("avatar_move", { id: marker.id, ...scene });
                }
                setDrag(null);
              }}>
              <AvatarView userId={marker.userId} name={marker.name} version={marker.avatarVersion} hasAvatar={marker.hasAvatar} size={size} />
            </button>
            <button className="canvas-avatar-remove" aria-label={"Remove " + marker.name + "'s avatar marker"} onClick={event => { event.stopPropagation(); avatarAction("avatar_remove", { id: marker.id }); }}>×</button>
          </div>;
        })}
        {placingAvatar && <button className="avatar-place-catcher" aria-label="Click to place avatar" />}
      </div>}
    </main>
  </div>;
}
