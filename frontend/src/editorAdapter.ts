import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { elementFingerprint } from "./syncCore";
import type { ElementData, Files, Presence } from "./protocol";
import type { SessionView, SyncSession } from "./syncSession";

/** The only boundary between persisted drawing data and Excalidraw's richer types. */
export class EditorAdapter {
  readonly editorRef: { current: ExcalidrawImperativeAPI | null } = { current: null };
  private applying = false;
  private lastDrawn = "";
  private renderedFiles = new Set<string>();
  private lastMode: string | undefined;
  private lastPageId: string | undefined;
  private lastEpoch: number | undefined;
  private cursors = new Map<string, { x: number; y: number }>();
  private people: Presence[] = [];

  constructor(private readonly participantId: string) {}

  draw(next: SessionView, force = false) {
    const editor = this.editorRef.current;
    if (!editor) return;
    const encoded = JSON.stringify(next.elements.map(elementFingerprint));
    this.applying = true;
    try {
      const epoch = next.snapshot?.board.epoch;
      if (epoch !== undefined && this.lastEpoch !== undefined && epoch !== this.lastEpoch) editor.history.clear();
      this.lastEpoch = epoch;
      const files = Object.values(next.files).filter((file) => force || !this.renderedFiles.has(file.id));
      if (files.length) {
        editor.addFiles(files as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
        files.forEach((file) => this.renderedFiles.add(file.id));
      }
      if (force || encoded !== this.lastDrawn) {
        this.lastDrawn = encoded;
        editor.updateScene({
          elements: structuredClone(next.elements) as unknown as Parameters<
            ExcalidrawImperativeAPI["updateScene"]
          >[0]["elements"],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      const mode = next.snapshot?.board.mode;
      const pageId = next.snapshot?.board.pageId;
      if (
        (mode === "poker" && (force || this.lastMode !== "poker")) ||
        (pageId && this.lastPageId && this.lastPageId !== pageId)
      ) {
        this.cursors.clear();
        editor.updateScene({ collaborators: new Map() });
      }
      this.lastMode = mode;
      this.lastPageId = pageId;
    } finally {
      this.applying = false;
    }
  }

  localChange(controller: SyncSession, elements: readonly ExcalidrawElement[], files: BinaryFiles) {
    if (this.applying) return;
    const drawing = elements as unknown as readonly ElementData[];
    this.lastDrawn = JSON.stringify(drawing.map(elementFingerprint));
    controller.localChange(drawing, files as unknown as Files);
  }

  presence(people: Presence[]) {
    this.people = people;
    this.updateCursors();
  }

  cursor(id: string, x: number, y: number) {
    this.cursors.set(id, { x, y });
    this.updateCursors();
  }

  private updateCursors() {
    if (this.lastMode !== "standard") return;
    const collaborators = new Map(
      this.people
        .filter((person) => person.id !== this.participantId)
        .map((person) => {
          const pointer = this.cursors.get(person.id);
          return [
            person.id,
            {
              username: person.name,
              pointer: pointer ? { ...pointer, tool: "pointer" as const } : undefined,
              color: { background: "#dce7fd", stroke: "#315bcb" },
            },
          ];
        })
    );
    this.editorRef.current?.updateScene({ collaborators } as Parameters<
      ExcalidrawImperativeAPI["updateScene"]
    >[0]);
  }
}
