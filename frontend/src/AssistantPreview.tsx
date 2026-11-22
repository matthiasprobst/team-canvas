import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AssistantProposal } from "./assistant";
import { markdownSource, MARKDOWN_LINK } from "./markdownCore";
import { Modal } from "./Dialog";

const MarkdownContent = lazy(() => import("./MarkdownContent"));
export interface PreviewSnapshot {
  proposal: AssistantProposal;
  before: readonly ExcalidrawElement[];
  after: readonly ExcalidrawElement[];
  changedIds: string[];
  files: BinaryFiles;
  signature: string;
  generation: number;
}

export default function AssistantPreview({ snapshot, current, ready, refresh, approve, close }: {
  snapshot: PreviewSnapshot; current: boolean; ready: boolean;
  refresh: () => void; approve: () => void; close: () => void;
}) {
  const [version, setVersion] = useState<"before" | "after">("after");
  const elements = version === "after" ? snapshot.after : snapshot.before;
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const fit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const affected = [...snapshot.before, ...snapshot.after].filter(element => !element.isDeleted && snapshot.changedIds.includes(element.id));
    const bounds = affected.length ? affected : editor.getSceneElements();
    if (!bounds.length) return;
    const x = Math.min(...bounds.map(element => element.x)), y = Math.min(...bounds.map(element => element.y));
    const frame = { ...bounds[0], type: "rectangle" as const, angle: 0, x, y,
      width: Math.max(...bounds.map(element => element.x + element.width)) - x,
      height: Math.max(...bounds.map(element => element.y + element.height)) - y, boundElements: null, frameId: null };
    editor.scrollToContent([frame], { fitToContent: true, animate: false });
  }, [snapshot]);
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); });
    if (container.current) observer.observe(container.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [fit, version]);
  return <Modal title="Preview canvas changes" close={close}>
    <div className="assistant-preview" onKeyDown={event => event.stopPropagation()}>
      <p>{snapshot.proposal.message}</p>
      <div className="assistant-preview-controls" role="group" aria-label="Preview version">
        <button className="button" aria-pressed={version === "before"} onClick={() => setVersion("before")}>Before</button>
        <button className="button" aria-pressed={version === "after"} onClick={() => setVersion("after")}>After</button>
        <span>Read-only preview. Changes have not been applied.</span>
      </div>
      <div ref={container} className="assistant-preview-canvas" aria-label={`${version === "after" ? "Proposed" : "Current"} canvas preview`}>
        <Excalidraw key={`${snapshot.generation}:${version}`} viewModeEnabled handleKeyboardGlobally={false}
          initialData={{ elements: structuredClone(elements), files: structuredClone(snapshot.files), appState: { viewBackgroundColor: "#ffffff" } }}
          excalidrawAPI={editor => { editorRef.current = editor; requestAnimationFrame(fit); }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } }}
          validateEmbeddable={link => link === MARKDOWN_LINK}
          onLinkOpen={(_element, event) => event.preventDefault()}
          renderEmbeddable={element => <article className="markdown-note"><div className="markdown-note-body"><Suspense fallback={<p>Loading…</p>}><MarkdownContent source={markdownSource(element) ?? ""} /></Suspense></div></article>}
        />
      </div>
      {!current && <p role="status">The canvas changed. Refresh the preview before approving.</p>}
      <div className="dialog-actions">
        <button className="button" onClick={close}>Back to chat</button>
        <button className="button" disabled={!ready} onClick={refresh}>Refresh preview</button>
        <button className="button primary" disabled={!current || !ready} onClick={approve}>Approve changes</button>
      </div>
    </div>
  </Modal>;
}
