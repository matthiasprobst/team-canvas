import type {
  BoardCommand,
  ControlType,
  ElementData,
  Files,
  PageAction,
  ServerEvent,
  Snapshot,
  TimerAction,
} from "./protocol";
import { elementFingerprint, indexById, mergeById, normalizeElement, restoreLockedPublic } from "./syncCore";

// getRandomValues is also available on development HTTP origins in a private network.
function commandId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const PATCH_BATCH_ELEMENTS = 50;
const PATCH_BATCH_BYTES = 1_800_000;
const ACK_TIMEOUT_MS = 15_000;
const THROTTLE_RETRY_MS = 1200;

type Flight = { command: BoardCommand; accepted: boolean; dispatchedAt: number; retryAfter: number | null };
type QueuedAction = { type: ControlType } | PageAction;
export interface SessionView {
  snapshot: Snapshot | null;
  elements: ElementData[];
  files: Files;
  online: boolean;
  busy: boolean;
  unsaved: boolean;
  recovery: ElementData[];
  error: string;
}

/** Authoritative state, optimistic changes, and transport retries have separate lifecycles. */
export class SyncSession {
  private snapshot: Snapshot | null = null;
  private canonical: ElementData[] = [];
  private pending = new Map<string, ElementData>();
  private files: Files = {};
  private knownFiles = new Set<string>();
  private flight: Flight | null = null;
  private action: QueuedAction | null = null;
  private awaitingState = false;
  private online = false;
  private recovery: ElementData[] = [];
  private error = "";

  constructor(
    private readonly send: (packet: object) => boolean,
    private readonly changed: (view: SessionView) => void,
    private readonly createId: () => string = commandId,
    private readonly clock: () => number = () => Date.now()
  ) {}

  view(): SessionView {
    const overlay =
      this.flight?.command.type === "patch" && !this.flight.accepted ? this.flight.command.elements : [];
    return {
      snapshot: this.snapshot,
      elements: mergeById(mergeById(this.canonical, overlay), [...this.pending.values()]),
      files: this.files,
      online: this.online,
      busy: !!this.action || this.awaitingState,
      unsaved: !!this.flight || this.pending.size > 0,
      recovery: this.recovery,
      error: this.error,
    };
  }

  private emit() {
    this.changed(this.view());
  }

  disconnected(message = "Connection lost. Changes are kept locally until you reconnect.") {
    this.online = false;
    this.error = message;
    this.emit();
  }

  localChange(elements: readonly ElementData[], files: Files) {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      !this.online ||
      this.action ||
      this.awaitingState
    )
      return;
    let changed = Object.keys(files).some((id) => !this.files[id]);
    this.files = { ...this.files, ...files };
    const current = indexById(this.view().elements);
    let actual = elements.map(normalizeElement);
    if (snapshot.board.mode === "poker") {
      const authoritative = indexById(this.canonical);
      const published = new Map<string, ElementData>();
      for (const id of snapshot.publicIds) {
        const element = authoritative.get(id);
        if (element) published.set(id, element);
      }
      const result = restoreLockedPublic(actual, published);
      actual = result.elements;
      changed ||= result.reverted;
    }
    for (const element of actual) {
      if (elementFingerprint(element) !== elementFingerprint(current.get(element.id))) {
        this.pending.set(element.id, structuredClone(element));
        changed = true;
      }
      current.delete(element.id);
    }
    for (const [id, element] of current) {
      if (!element.isDeleted) {
        this.pending.set(id, { ...element, isDeleted: true });
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** At most one command is in flight; acknowledgements are a persistence barrier. */
  flush() {
    if (!this.online || !this.snapshot || this.awaitingState) return;
    if (this.flight) {
      const now = this.clock();
      if (now >= (this.flight.retryAfter ?? this.flight.dispatchedAt + ACK_TIMEOUT_MS)) {
        this.flight.dispatchedAt = now;
        this.flight.retryAfter = null;
        if (!this.send(this.flight.command)) this.online = false;
        this.emit();
      }
      return;
    }
    if (this.pending.size) {
      const elements: ElementData[] = [];
      const files: Files = {};
      let bytes = 0;
      for (const element of this.pending.values()) {
        if (elements.length >= PATCH_BATCH_ELEMENTS) break;
        const id = element.type === "image" && !element.isDeleted ? String(element.fileId ?? "") : "";
        const file = id && !this.knownFiles.has(id) ? this.files[id] : undefined;
        if (id && !this.knownFiles.has(id) && !file) continue;
        if (file && Object.keys(files).length && !files[id]) break;
        const size =
          new TextEncoder().encode(JSON.stringify(element)).length +
          (file && !files[id] ? JSON.stringify(file).length : 0);
        if (bytes + size > PATCH_BATCH_BYTES) break;
        elements.push(element);
        if (file) files[id] = file;
        bytes += size;
      }
      if (!elements.length) {
        this.error = "An image is not ready or a change is too large. Please check the image size.";
        this.action = null;
        this.emit();
        return;
      }
      elements.forEach((element) => this.pending.delete(element.id));
      this.dispatch({ ...this.context(), type: "patch", elements, files });
    } else if (this.action) {
      const context = this.context();
      this.dispatch({ ...context, ...this.action });
    }
  }

  control(type: ControlType) {
    this.queueAction({ type });
  }

  timerControl(action: TimerAction) {
    if (!this.online || !this.snapshot) return;
    this.send({ type: `timer_${action}`, commandId: commandId() });
  }

  setTimer(minutes: number, seconds: number) {
    if (!this.online || !this.snapshot) return;
    this.send({ type: "timer_set", commandId: commandId(), minutes, seconds });
  }

  createPage(copyCurrent: boolean, includePoker: boolean) {
    this.queueAction({ type: "create_page", copyCurrent, includePoker });
  }

  selectPage(pageId: string) {
    this.queueAction({ type: "select_page", targetPageId: pageId });
  }

  private queueAction(action: QueuedAction) {
    if (!this.online || !this.snapshot || this.action || this.awaitingState) return;
    if (this.snapshot.board.mode === "poker" && action.type !== "stop_round")
      return;
    this.action = action;
    this.flush();
    this.emit();
  }

  private context() {
    return {
      commandId: this.createId(),
      epoch: this.snapshot!.board.epoch,
      roundId: this.snapshot!.board.roundId,
      pageId: this.snapshot!.board.pageId,
    };
  }

  private dispatch(command: BoardCommand) {
    this.flight = { command, accepted: false, dispatchedAt: this.clock(), retryAfter: null };
    if (!this.send(command)) this.online = false;
    this.emit();
  }

  private preserveDraft() {
    const edits = this.flight?.command.type === "patch" ? this.flight.command.elements : [];
    this.recovery = mergeById(this.recovery, [...edits, ...this.pending.values()]);
    this.pending.clear();
    this.flight = null;
    this.action = null;
    this.awaitingState = false;
    if (this.recovery.length)
      this.error = "The canvas changed. Unconfirmed changes are available as a draft download.";
  }

  receive(event: ServerEvent) {
    switch (event.type) {
      case "metadata":
        if (this.snapshot)
          this.snapshot = { ...this.snapshot, board: { ...this.snapshot.board, name: event.name } };
        break;
      case "snapshot": {
        const previous = this.snapshot;
        const changedRound = previous && previous.board.epoch !== event.data.board.epoch;
        if (changedRound) this.preserveDraft();
        if (!changedRound && !this.recovery.length) this.error = "";
        this.snapshot = structuredClone(event.data);
        this.canonical = structuredClone(event.data.elements);
        this.knownFiles = new Set(event.data.fileIds);
        this.online = true;
        this.awaitingState = false;
        if (this.flight) {
          this.flight.dispatchedAt = this.clock();
          this.send(this.flight.command);
        } else this.flush();
        break;
      }
      case "patch":
        if (!this.snapshot || event.revision <= this.snapshot.board.revision) break;
        this.canonical = mergeById(this.canonical, structuredClone(event.elements));
        this.snapshot = { ...this.snapshot, board: { ...this.snapshot.board, revision: event.revision } };
        if (event.scope === "public")
          this.snapshot.publicIds = [
            ...new Set([...this.snapshot.publicIds, ...event.elements.map((el) => el.id)]),
          ];
        event.fileIds.forEach((id) => this.knownFiles.add(id));
        if (this.flight?.command.commandId === event.commandId) this.flight.accepted = true;
        break;
      case "ack":
        if (this.flight?.command.commandId !== event.commandId) break;
        if (this.flight.command.type !== "patch") {
          this.awaitingState = true;
          this.action = null;
        }
        this.flight = null;
        if (!this.recovery.length) this.error = "";
        this.flush();
        break;
      case "round":
        if (!this.snapshot || event.board.epoch !== this.snapshot.board.epoch) break;
        this.snapshot = { ...this.snapshot, board: event.board, round: event.round };
        this.awaitingState = false;
        break;
      case "timer":
        if (this.snapshot) this.snapshot = { ...this.snapshot, timer: event.timer };
        break;
      case "error":
        this.error = event.message;
        if (event.commandId && this.flight?.command.commandId === event.commandId) {
          if (event.code === "rate_limit") this.flight.retryAfter = this.clock() + THROTTLE_RETRY_MS;
          else {
            this.preserveDraft();
            this.error =
              event.message +
              (this.recovery.length ? " Unconfirmed changes are available as a draft download." : "");
          }
          if (event.code === "stale_round") this.send({ type: "resync" });
        }
        break;
    }
    this.emit();
  }

  reportError(message: string) {
    this.error = message;
    this.emit();
  }

  addFiles(files: Files) {
    this.files = { ...this.files, ...files };
    this.emit();
  }

  recoveryExported() {
    this.recovery = [];
    this.error = "";
    this.emit();
  }
}
