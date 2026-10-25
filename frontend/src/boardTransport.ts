import { draftCapability, forgetDraftCapability } from "./draftCapability";
import { checkCompanySession, type Identity } from "./api";
import { parseServerEvent } from "./protocolCodec";
import type { ServerEvent } from "./protocol";

let previousSocketClosed: Promise<void> = Promise.resolve();

interface TransportCallbacks {
  receive: (packet: ServerEvent) => void;
  disconnected: (message?: string) => void;
  flush: () => void;
}

/** Owns one socket, its retries and timers. A new canvas waits for the old socket to close. */
export class BoardTransport {
  private socket: WebSocket | null = null;
  private lastPointerAt = 0;

  send = (packet: object): boolean => {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(packet));
      return true;
    } catch {
      return false;
    }
  };

  pointer(x: number, y: number) {
    const now = performance.now();
    if (now - this.lastPointerAt < 65) return;
    this.lastPointerAt = now;
    this.send({ type: "cursor", x, y });
  }

  start(boardId: string, identity: Identity, callbacks: TransportCallbacks): () => void {
    let stopped = false;
    let canvasDeleted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastMessageAt = Date.now();
    const connect = async () => {
      await previousSocketClosed;
      if (stopped) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws/boards/${boardId}`);
      let rejectionMessage: string | undefined;
      let draftRound: string | null = null;
      this.socket = socket;
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ type: "hello", token: identity.token, protocolVersion: 2 }))
      );
      socket.addEventListener("message", (event) => {
        if (stopped || canvasDeleted || this.socket !== socket) return;
        lastMessageAt = Date.now();
        let packet: ServerEvent;
        try {
          packet = parseServerEvent(String(event.data));
        } catch {
          socket.close(1002);
          return;
        }
        if (packet.type === "error" && !packet.commandId) rejectionMessage = packet.message;
        if (packet.type === "error" && packet.code === "canvas_deleted") canvasDeleted = true;
        if (packet.type === "snapshot") {
          failures = 0;
          const roundId = packet.data.board.roundId;
          if (packet.data.board.mode === "poker" && roundId && draftRound !== roundId) {
            draftRound = roundId;
            try {
              socket.send(JSON.stringify({ type: "draft", roundId, capability: draftCapability(boardId, roundId) }));
            } catch {
              callbacks.disconnected("Private draft recovery requires available tab storage. Export local work before reloading.");
              socket.close(1008);
            }
            return;
          }
          if (!roundId && draftRound) {
            forgetDraftCapability(boardId, draftRound);
            draftRound = null;
          }
        }
        callbacks.receive(packet);
      });
      socket.addEventListener("close", (event) => {
        if (stopped || this.socket !== socket) return;
        callbacks.disconnected(
          rejectionMessage ??
            (event.code === 1008 && event.reason === "Access revoked"
              ? "Your access to this canvas was removed by its owner."
              : event.code === 1008 && ["login_expired", "Login expired"].includes(event.reason)
              ? "Your sign-in session expired. Reconnecting…"
              : event.code === 1008
              ? "Access expired, was revoked, or the room is full. Please rejoin."
              : undefined)
        );
        if (!canvasDeleted && event.code === 1006)
          void checkCompanySession().catch(() => {});
        if (!canvasDeleted && event.code === 1008 && ["login_expired", "Login expired"].includes(event.reason))
          void checkCompanySession()
            .then(() => { if (!stopped) retry = setTimeout(connect, 300); })
            .catch(() => { if (!stopped) callbacks.disconnected("Please sign in again to continue. Export unsaved work before reloading."); });
        if (!canvasDeleted && event.code !== 1008)
          retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** failures++) + Math.random() * 400);
      });
      socket.addEventListener("error", () => socket.close());
    };
    void connect();
    const flush = setInterval(() => callbacks.flush(), 110);
    const heartbeat = setInterval(() => {
      const socket = this.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > 45_000) socket.close(4000, "Heartbeat timeout");
      else socket.send(JSON.stringify({ type: "ping" }));
    }, 15_000);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(flush);
      clearInterval(heartbeat);
      const socket = this.socket;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        previousSocketClosed = new Promise((resolve) =>
          socket.addEventListener("close", () => resolve(), { once: true })
        );
        socket.close();
      }
      this.socket = null;
    };
  }
}
