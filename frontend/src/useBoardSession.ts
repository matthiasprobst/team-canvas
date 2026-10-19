import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { checkCompanySession, fetchAsset, type Identity } from "./api";
import { SyncSession, type SessionView } from "./syncSession";
import { parseServerEvent } from "./protocolCodec";
import { elementFingerprint } from "./syncCore";
import type { ControlType, ElementData, Files, Presence, ServerEvent } from "./protocol";

let previousSocketClosed: Promise<void> = Promise.resolve();

const initialView: SessionView = { snapshot: null, elements: [], files: {}, online: false, busy: false, unsaved: false, recovery: [], error: "" };

export function useBoardSession(boardId: string, identity: Identity) {
  const [view, setView] = useState<SessionView>(initialView);
  const [people, setPeople] = useState<Presence[]>([]);
  const [deleted, setDeleted] = useState(false);
  const editorRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const viewRef = useRef(view);
  const applyRef = useRef(false);
  const lastDrawn = useRef("");
  const renderedFiles = useRef(new Set<string>());
  const lastMode = useRef<string | undefined>(undefined);
  const cursors = useRef(new Map<string, { x: number; y: number }>());
  const peopleRef = useRef<Presence[]>([]);
  const publishRef = useRef<(next: SessionView) => void>(() => {});
  const controllerRef = useRef<SyncSession | null>(null);
  if (!controllerRef.current) controllerRef.current = new SyncSession(packet => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(packet)); return true; } catch { return false; }
  }, next => publishRef.current(next));
  const controller = controllerRef.current;

  const draw = useCallback((next: SessionView, force = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    const encoded = JSON.stringify(next.elements.map(elementFingerprint));
    applyRef.current = true;
    try {
      const files = Object.values(next.files).filter(file => force || !renderedFiles.current.has(file.id));
      if (files.length) {
        editor.addFiles(files as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
        files.forEach(file => renderedFiles.current.add(file.id));
      }
      if (force || encoded !== lastDrawn.current) {
        lastDrawn.current = encoded;
        editor.updateScene({
          elements: structuredClone(next.elements) as unknown as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]["elements"],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      if (next.snapshot?.board.mode === "poker" && (force || lastMode.current !== "poker")) {
        cursors.current.clear();
        editor.updateScene({ collaborators: new Map() });
      }
      lastMode.current = next.snapshot?.board.mode;
    } finally { applyRef.current = false; }
  }, []);

  publishRef.current = next => {
    viewRef.current = next;
    setView(next);
    draw(next);
  };

  const updateCursors = useCallback(() => {
    if (viewRef.current.snapshot?.board.mode !== "standard") return;
    const collaborators = new Map(peopleRef.current.filter(person => person.id !== identity.participantId).map(person => [person.id, {
      username: person.name,
      pointer: cursors.current.has(person.id) ? { ...cursors.current.get(person.id)!, tool: "pointer" as const } : undefined,
      color: { background: "#dce7fd", stroke: "#315bcb" },
    }]));
    editorRef.current?.updateScene({ collaborators } as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]);
  }, [identity.participantId]);

  useEffect(() => {
    let stopped = false;
    let canvasDeleted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastMessageAt = Date.now();
    async function connect() {
      await previousSocketClosed;
      if (stopped) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws/boards/${boardId}`);
      let rejectionMessage: string | undefined;
      socketRef.current = socket;
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "hello", token: identity.token })));
      socket.addEventListener("message", event => {
        if (stopped || canvasDeleted || socketRef.current !== socket) return;
        lastMessageAt = Date.now();
        let packet: ServerEvent;
        try { packet = parseServerEvent(String(event.data)); } catch { socket.close(1002); return; }
        if (packet.type === "error" && !packet.commandId) rejectionMessage = packet.message;
        if (packet.type === "error" && packet.code === "canvas_deleted") {
          canvasDeleted = true; setDeleted(true); setPeople([]);
          controller.disconnected(packet.message);
          return;
        }
        if (packet.type === "presence") {
          peopleRef.current = packet.participants;
          setPeople(packet.participants);
          updateCursors();
        } else if (packet.type === "cursor") {
          cursors.current.set(packet.id, { x: packet.x, y: packet.y });
          updateCursors();
        } else if (packet.type !== "pong") {
          if (packet.type === "snapshot") failures = 0;
          controller.receive(packet);
        }
      });
      socket.addEventListener("close", event => {
        if (stopped || socketRef.current !== socket) return;
        controller.disconnected(rejectionMessage ?? (event.code === 1008 ? "Access expired, was revoked, or the room is full. Please rejoin." : undefined));
        if (!canvasDeleted && (event.code === 1008 || event.code === 1006)) void checkCompanySession().catch(() => {});
        if (!canvasDeleted && event.code !== 1008) retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** failures++) + Math.random() * 400);
      });
      socket.addEventListener("error", () => socket.close());
    }
    void connect();
    const flush = setInterval(() => controller.flush(), 110);
    const heartbeat = setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > 45_000) socket.close(4000, "Heartbeat timeout");
      else socket.send(JSON.stringify({ type: "ping" }));
    }, 15_000);
    const unload = (event: BeforeUnloadEvent) => {
      if (controller.view().unsaved || controller.view().recovery.length || (!canvasDeleted && (controller.view().busy || (controller.view().snapshot?.round?.included && !controller.view().snapshot?.round?.done)))) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(flush);
      clearInterval(heartbeat);
      window.removeEventListener("beforeunload", unload);
      const socket = socketRef.current;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        previousSocketClosed = new Promise(resolve => socket.addEventListener("close", () => resolve(), { once: true }));
        socket.close();
      }
      socketRef.current = null;
    };
  }, [boardId, identity.token, controller, updateCursors]);

  const missingAssetsKey = JSON.stringify([...new Set(view.elements.filter(el => el.type === "image" && !el.isDeleted)
    .map(el => String(el.fileId ?? "")).filter(id => id && !view.files[id]))].sort());
  useEffect(() => {
    if (!view.online) return;
    const abort = new AbortController();
    const ids = JSON.parse(missingAssetsKey) as string[];
    const loaded: Files = {};
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length && !abort.signal.aborted) {
        const id = ids[cursor++];
        try {
          const file = await fetchAsset(boardId, id, identity.token, abort.signal);
          if (!abort.signal.aborted) loaded[id] = file;
        } catch (error) {
          if (!abort.signal.aborted) setView(current => ({ ...current, error: error instanceof Error ? error.message : "Could not load image." }));
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)).then(() => {
      if (!abort.signal.aborted && Object.keys(loaded).length) controller.addFiles(loaded);
    });
    return () => abort.abort();
  }, [boardId, identity.token, view.online, missingAssetsKey, controller]);

  const onChange = useCallback((elements: readonly ElementData[], files: Files) => {
    if (applyRef.current) return;
    lastDrawn.current = JSON.stringify(elements.map(elementFingerprint));
    controller.localChange(elements, files);
  }, [controller]);

  const setEditor = useCallback((editor: ExcalidrawImperativeAPI) => {
    editorRef.current = editor;
    draw(controller.view(), true);
  }, [controller, draw]);

  const lastPointerAt = useRef(0);
  const pointer = useCallback((x: number, y: number) => {
    const now = performance.now();
    if (viewRef.current.snapshot?.board.mode !== "standard" || !viewRef.current.online || now - lastPointerAt.current < 65) return;
    lastPointerAt.current = now;
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "cursor", x, y }));
  }, []);

  const control = useCallback((type: ControlType) => controller.control(type), [controller]);
  const recoveryExported = useCallback(() => controller.recoveryExported(), [controller]);
  return { view, people, deleted, editorRef, onChange, setEditor, pointer, control, recoveryExported };
}
