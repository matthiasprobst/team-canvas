import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { createBoard, joinBoard, rotateInvitation, type Identity } from "./api";
import { useBoardSession } from "./useBoardSession";
import type { ElementData, Files } from "./protocol";

function Home() {
  const [name, setName] = useState("Neues Whiteboard");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const board = await createBoard(name);
      localStorage.setItem(`host:${board.id}`, board.hostKey);
      localStorage.setItem(`invite:${board.id}`, board.inviteKey);
      location.assign(`/b/${board.id}`);
    } catch (err) { setError(String(err)); setBusy(false); }
  };
  return <div className="home"><main className="panel">
    <h1>Team Canvas</h1>
    <p>Gemeinsam zeichnen, Notizen und Bilder platzieren – oder Ideen im Poker-Modus verdeckt sammeln.</p>
    <form onSubmit={submit}>
      <label htmlFor="board-name">Boardname</label>
      <input id="board-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} required />
      <button className="primary" disabled={busy}>Board erstellen</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p className="mini">Teile den Einladungslink mit bis zu neun weiteren aktiven Personen. Im Firmennetz erfolgt die Anmeldung über dein Firmenkonto.</p>
  </main></div>;
}

function Join({ boardId }: { boardId: string }) {
  const [name, setName] = useState(localStorage.getItem("displayName") ?? "");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hostKey = localStorage.getItem(`host:${boardId}`);
  const [inviteKey] = useState(() => {
    const key = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (key) {
      sessionStorage.setItem(`invite:${boardId}`, key);
      history.replaceState(null, "", location.pathname);
    }
    return key ?? sessionStorage.getItem(`invite:${boardId}`) ?? localStorage.getItem(`invite:${boardId}`);
  });
  const storedToken = sessionStorage.getItem(`token:${boardId}`);
  const autoJoined = useRef(false);

  const join = useCallback(async (chosenName: string, token: string | null) => {
    setBusy(true); setError("");
    try {
      const result = await joinBoard(boardId, chosenName, token, hostKey, inviteKey);
      sessionStorage.setItem(`token:${boardId}`, result.token);
      localStorage.setItem("displayName", chosenName);
      setIdentity(result);
    } catch (err) {
      if (token) sessionStorage.removeItem(`token:${boardId}`);
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    }
    finally { setBusy(false); }
  }, [boardId, hostKey, inviteKey]);

  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    if (storedToken) void join(name || "Gast", storedToken);
    else if (hostKey) void join(name || "Leitung", null);
    // Run once for this board; joining twice could create two independent guests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  if (identity) return <BoardEditor boardId={boardId} identity={identity} />;
  return <div className="home"><main className="panel">
    <h1>Board beitreten</h1>
    <p>Wähle einen Anzeigenamen. Zum ersten Beitritt benötigst du einen gültigen Einladungslink.</p>
    <form onSubmit={e => { e.preventDefault(); void join(name, storedToken); }}>
      <label htmlFor="guest-name">Dein Name</label>
      <input id="guest-name" value={name} onChange={e => setName(e.target.value)} maxLength={48} autoFocus required />
      <button className="primary" disabled={busy || !name.trim()}>Beitreten</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p className="mini">Die Board-Adresse dient als Einladungslink. Teile sie nur mit vertrauenswürdigen Personen.</p>
  </main></div>;
}

function BoardEditor({ boardId, identity }: { boardId: string; identity: Identity }) {
  const { view, people, editorRef, onChange, setEditor, pointer, control, recoveryExported } = useBoardSession(boardId, identity);
  const { snapshot, online, error } = view;
  const [sharingError, setSharingError] = useState("");
  const sticky = () => {
    const editor = editorRef.current;
    if (!editor || !editable) return;
    const app = editor.getAppState();
    const x = -app.scrollX + 140;
    const y = -app.scrollY + 120;
    const notes = convertToExcalidrawElements([{
      type: "rectangle", x, y, width: 220, height: 170,
      backgroundColor: "#fff3bf", fillStyle: "solid", strokeColor: "#b08900",
      label: {text: "Notiz", fontSize: 22, textAlign: "left", verticalAlign: "top"},
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
  const share = async () => {
    try {
      let key = localStorage.getItem(`invite:${boardId}`) ?? sessionStorage.getItem(`invite:${boardId}`);
      if (!key && isHost) {
        key = (await rotateInvitation(boardId, identity.token, false)).inviteKey;
        localStorage.setItem(`invite:${boardId}`, key);
      }
      if (!key) { setSharingError("Bitte die Leitung um einen Einladungslink bitten."); return; }
      const link = `${location.origin}/b/${boardId}#invite=${encodeURIComponent(key)}`;
      try { await navigator.clipboard.writeText(link); } catch { prompt("Einladungslink kopieren:", link); }
    } catch (err) { setSharingError(String(err)); }
  };
  const revoke = async () => {
    if (!confirm("Alle Gastzugänge widerrufen und einen neuen Einladungslink erstellen?")) return;
    try {
      const result = await rotateInvitation(boardId, identity.token, true);
      localStorage.setItem(`invite:${boardId}`, result.inviteKey);
      setSharingError("Gastzugänge widerrufen. Der neue Link kann jetzt geteilt werden.");
    } catch (err) { setSharingError(String(err)); }
  };
  const downloadDraft = () => {
    const elements = view.recovery.length ? view.recovery : view.elements;
    const ids = new Set(elements.filter(element => element.type === "image").map(element => String(element.fileId)));
    const files = Object.fromEntries(Object.entries(view.files).filter(([id]) => ids.has(id)));
    const blob = new Blob([JSON.stringify({ type: "excalidraw", version: 2, source: location.origin,
      elements, files, appState: { viewBackgroundColor: "#ffffff" } }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "team-canvas-entwurf.excalidraw"; link.click();
    URL.revokeObjectURL(url);
    if (view.recovery.length) recoveryExported();
  };

  return <div className="layout">
    <header className="topbar">
      <strong>{snapshot?.board.name ?? "Board"}</strong>
      <span className={`pill ${online ? "" : "offline"}`}>{online ? (view.unsaved ? "● Speichert …" : "● Gespeichert") : "○ Offline"}</span>
      {poker && <span className="pill poker">🔒 Poker-Runde</span>}
      <div className="spacer" />
      <button onClick={sticky} disabled={!editable}>＋ Notizzettel</button>
      <button onClick={() => void share()}>↗ Link teilen</button>
      {!online && error && <button onClick={() => {
        sessionStorage.removeItem(`token:${boardId}`);
        location.reload();
      }}>Erneut beitreten</button>}
      {isHost && !poker && <button className="primary" onClick={() => control("start_round")} disabled={!online || view.busy}>Poker starten</button>}
      {poker && editable && <button className="primary" onClick={() => control("done")}>✓ Fertig</button>}
      {poker && round?.done && <span className="pill">Dein Beitrag ist gesperrt</span>}
      {poker && isHost && <button disabled={!online || view.busy} onClick={() => {
        if (confirm("Runde abbrechen und alle verdeckten Beiträge löschen?")) control("cancel_round");
      }}>Runde abbrechen</button>}
      {!poker && isHost && <button disabled={!online || view.busy} onClick={() => void revoke()}>Gastzugänge widerrufen</button>}
      {(view.recovery.length > 0 || (!online && view.unsaved)) && <button onClick={downloadDraft}>Entwurf herunterladen</button>}
    </header>
    {(error || sharingError) && <div className="message" role="alert">{error || sharingError}</div>}
    <div className="sidebar">
      <span><b>{people.length}/10</b> aktiv</span>
      {people.map(person => <span key={person.id} className="pill">
        {person.role === "host" ? "★ " : ""}{person.name}{poker ? (round?.members.find(member => member.id === person.id)?.done ? " ✓" : " …") : ""}
      </span>)}
      {poker && <span className="mini">Verdeckte Beiträge nur für dich sichtbar · automatische Aufdeckung, sobald alle bereit sind
        {round ? ` · ${round.members.filter(member => member.done).length}/${round.members.length} bereit` : ""}
      </span>}
      {poker && round?.members.filter(member => !people.some(person => person.id === member.id)).map(member =>
        <span key={member.id} className="pill">{member.name} · offline{member.done ? " ✓" : " · noch nicht bereit"}</span>)}
      {!poker && <span className="mini">Gemeinsam Formen, Text und Bilder bearbeiten. Bilder per Drag & Drop einfügen.</span>}
    </div>
    <main className="editor">
      <Excalidraw
        excalidrawAPI={setEditor}
        isCollaborating
        viewModeEnabled={!editable}
        onChange={(elements, _appState, files) => onChange(elements as unknown as readonly ElementData[], files as unknown as Files)}
        onPointerUpdate={({ pointer: position }) => pointer(position.x, position.y)}
      />
    </main>
  </div>;
}

export default function App() {
  const match = location.pathname.match(/^\/b\/([0-9a-fA-F-]{36})\/?$/);
  return match ? <Join boardId={match[1]} /> : <Home />;
}
