import { useCallback, useEffect, useRef, useState } from "react";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Identity } from "./api";
import type { ControlType, Presence, TimerAction } from "./protocol";
import { BoardTransport } from "./boardTransport";
import { EditorAdapter } from "./editorAdapter";
import { SyncSession, type SessionView } from "./syncSession";
import { useBoardAssets } from "./useBoardAssets";

const initialView: SessionView = {
  snapshot: null,
  elements: [],
  files: {},
  online: false,
  busy: false,
  unsaved: false,
  recovery: [],
  error: "",
};

/** React subscribes to the session; transport and editor lifecycles stay at their own boundaries. */
export function useBoardSession(boardId: string, identity: Identity) {
  const [view, setView] = useState<SessionView>(initialView);
  const [people, setPeople] = useState<Presence[]>([]);
  const [connections, setConnections] = useState(0);
  const [maxConnections, setMaxConnections] = useState<number | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [transport] = useState(() => new BoardTransport());
  const [adapter] = useState(() => new EditorAdapter(identity.participantId));
  const publishRef = useRef<(next: SessionView) => void>(() => {});
  const [controller] = useState(() => new SyncSession(transport.send, (next) => publishRef.current(next)));

  publishRef.current = (next) => {
    setView(next);
    adapter.draw(next);
  };

  useEffect(
    () =>
      transport.start(boardId, identity, {
        flush: () => controller.flush(),
        disconnected: (message) => {
          setPeople([]);
          setConnections(0);
          setMaxConnections(null);
          adapter.presence([]);
          controller.disconnected(message);
        },
        receive: (packet) => {
          if (packet.type === "error" && packet.code === "canvas_deleted") {
            setDeleted(true);
            setPeople([]);
            setConnections(0);
            setMaxConnections(null);
            adapter.presence([]);
            controller.disconnected(packet.message);
          } else if (packet.type === "presence") {
            setPeople(packet.participants);
            setConnections(packet.connections);
            setMaxConnections(packet.maxConnections);
            adapter.presence(packet.participants);
          } else if (packet.type === "cursor") {
            adapter.cursor(packet.id, packet.x, packet.y);
          } else if (packet.type !== "pong") {
            controller.receive(packet);
          }
        },
      }),
    [boardId, identity, transport, controller, adapter]
  );

  useBoardAssets(boardId, identity.token, view.online, view.elements, view.files, controller);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
      adapter.localChange(controller, elements, files);
    },
    [adapter, controller]
  );
  const setEditor = useCallback(
    (editor: ExcalidrawImperativeAPI) => {
      adapter.editorRef.current = editor;
      adapter.draw(controller.view(), true);
    },
    [adapter, controller]
  );
  const pointer = useCallback(
    (x: number, y: number) => {
      const current = controller.view();
      if (current.snapshot?.board.mode === "standard" && current.online) transport.pointer(x, y);
    },
    [controller, transport]
  );
  const control = useCallback((type: ControlType) => controller.control(type), [controller]);
  const timerControl = useCallback((action: TimerAction) => controller.timerControl(action), [controller]);
  const setTimer = useCallback((minutes: number, seconds: number) => controller.setTimer(minutes, seconds), [controller]);
  const createPage = useCallback(
    (copyCurrent: boolean, includePoker: boolean) => controller.createPage(copyCurrent, includePoker),
    [controller]
  );
  const selectPage = useCallback((pageId: string) => controller.selectPage(pageId), [controller]);
  const recoveryExported = useCallback(() => controller.recoveryExported(), [controller]);
  return {
    view,
    people,
    connections,
    maxConnections,
    deleted,
    editorRef: adapter.editorRef,
    onChange,
    setEditor,
    pointer,
    control,
    timerControl,
    setTimer,
    createPage,
    selectPage,
    recoveryExported,
  };
}
