import { lazy, Suspense, useCallback, useState } from "react";
import { CaptureUpdateAction, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Modal } from "./Dialog";
import { MARKDOWN_LIMIT, MARKDOWN_LINK, markdownSource } from "./markdownCore";
import { createMarkdownElement } from "./markdownElement";
import type { SessionView } from "./syncSession";

const MarkdownContent = lazy(() => import("./MarkdownContent"));
const starter = "# Ticket title\n\nDescribe the goal and expected behaviour.\n\n## Acceptance criteria\n- [ ] First criterion\n- [ ] Second criterion\n";
export const validateMarkdownEmbed = (link: string) => link === MARKDOWN_LINK;
interface Draft { id: string | null; original: string; context: string; }

function NoteEditor({ draft, editable, save, close }: { draft: Draft; editable: boolean; save: (text: string) => void; close: () => void }) {
  const [text, setText] = useState(draft.original);
  const [error, setError] = useState("");
  return <Modal title={draft.id ? "Edit Markdown note" : "New Markdown note"} close={close}>
    <form className="markdown-editor" onSubmit={event => { event.preventDefault(); try { save(text); } catch (failure) { setError((failure as Error).message); } }}>
      <p className="mini">Headings, lists, task lists, links, tables, and code blocks. Image exports show a placeholder.</p>
      <div className="markdown-editor-columns">
        <label>Markdown source<textarea autoFocus aria-label="Markdown source" value={text} maxLength={MARKDOWN_LIMIT} onChange={event => setText(event.target.value)} spellCheck={false} /></label>
        <section className="markdown-editor-preview" aria-label="Markdown preview"><Suspense fallback={<p>Loading preview…</p>}><MarkdownContent source={text} /></Suspense></section>
      </div>
      <span className="mini">{text.length.toLocaleString()} / {MARKDOWN_LIMIT.toLocaleString()} characters. Edit task checkboxes in the source.</span>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" disabled={!editable || !text.trim()}>Save Markdown note</button></div>
    </form>
  </Modal>;
}

export function useMarkdownNotes(editorRef: { current: ExcalidrawImperativeAPI | null }, view: SessionView, deleted: boolean) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const board = view.snapshot?.board;
  const context = `${board?.id}:${board?.pageId}:${board?.epoch}`;
  const ready = view.online && !view.busy && !view.unsaved && !deleted;
  const canEdit = (element: ExcalidrawElement) => ready && !element.isDeleted && !element.locked &&
    !(board?.mode === "poker" && view.snapshot?.publicIds.includes(element.id));
  const selected = view.elements.find(element => element.id === selectedId && !element.isDeleted);
  const selectedMarkdown = selected && markdownSource(selected) !== null ? selected : undefined;

  const selectionChanged = useCallback((elements: readonly ExcalidrawElement[], app: AppState) => {
    const ids = Object.keys(app.selectedElementIds).filter(id => app.selectedElementIds[id]);
    const element = ids.length === 1 ? elements.find(item => item.id === ids[0] && !item.isDeleted) : undefined;
    setSelectedId(element && markdownSource(element) !== null ? element.id : null);
  }, []);

  function edit(id: string) {
    const element = editorRef.current?.getSceneElements().find(item => item.id === id);
    if (!element || !canEdit(element)) return;
    const original = markdownSource(element);
    if (original !== null) setDraft({ id, original, context });
  }

  function save(text: string) {
    const editor = editorRef.current;
    if (!editor || !ready || !draft || draft.context !== context) throw new Error("Wait for Saved before saving this note.");
    if (!text.trim() || text.length > MARKDOWN_LIMIT) throw new Error("Keep Markdown notes between 1 and 10,000 characters.");
    const elements = editor.getSceneElementsIncludingDeleted();
    let next;
    if (draft.id) {
      const current = elements.find(element => element.id === draft.id);
      if (!current || !canEdit(current)) throw new Error("This note is no longer editable.");
      if (markdownSource(current) !== draft.original) throw new Error("Someone changed this note. Copy your source, cancel, and reopen it to review their changes.");
      next = elements.map(element => element.id !== current.id ? element : {
        ...current, customData: { teamCanvasKind: "markdown", markdown: text },
        version: current.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 30), updated: Date.now(),
      });
    } else {
      const app = editor.getAppState();
      const origin = viewportCoordsToSceneCoords({ clientX: app.offsetLeft + app.width * 0.3, clientY: app.offsetTop + app.height * 0.2 }, app);
      const note = createMarkdownElement(text, origin.x, origin.y);
      next = [...elements, note];
      editor.updateScene({ appState: { selectedElementIds: { [note.id]: true } } });
    }
    editor.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setDraft(null);
  }

  const renderEmbeddable: NonNullable<ExcalidrawProps["renderEmbeddable"]> = element => {
    const source = markdownSource(element);
    if (source === null) return <div className="markdown-note">Unsupported embedded content</div>;
    return <article className="markdown-note" aria-label="Markdown note" data-markdown-note-id={element.id} style={{ backgroundColor: element.backgroundColor === "transparent" ? "#ffffff" : element.backgroundColor }}>
      <header><span>Markdown note</span><button type="button" disabled={!canEdit(element)} onClick={event => { event.stopPropagation(); edit(element.id); }}>Edit</button></header>
      <div className="markdown-note-body"><Suspense fallback={<p>Loading Markdown…</p>}><MarkdownContent source={source} /></Suspense></div>
    </article>;
  };

  return {
    renderEmbeddable, selectionChanged,
    onLinkOpen: ((element, event) => {
      if (markdownSource(element) !== null) event.preventDefault();
    }) satisfies NonNullable<ExcalidrawProps["onLinkOpen"]>,
    create: () => { if (ready) setDraft({ id: null, original: starter, context }); },
    editSelected: () => { if (selectedId) edit(selectedId); },
    canEditSelected: !!selectedMarkdown && canEdit(selectedMarkdown as unknown as ExcalidrawElement),
    selectedMarkdown: !!selectedMarkdown,
    dialog: draft?.context === context ? <NoteEditor key={`${draft.id}:${context}`} draft={draft} editable={ready} save={save} close={() => setDraft(null)} /> : null,
    ready,
  };
}
