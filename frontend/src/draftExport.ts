import type { SessionView } from "./syncSession";

/** Exports only images referenced by this draft, including private recovery data. */
export function draftDocument(view: SessionView, recovered: boolean, origin: string) {
  const elements = recovered ? view.recovery : view.elements;
  const ids = new Set(
    elements.filter((element) => element.type === "image").map((element) => String(element.fileId))
  );
  const files = Object.fromEntries(Object.entries(view.files).filter(([id]) => ids.has(id)));
  return {
    type: "excalidraw",
    version: 2,
    source: origin,
    elements,
    files,
    appState: { viewBackgroundColor: "#ffffff" },
  };
}

export function downloadDraft(view: SessionView, recovered: boolean) {
  const blob = new Blob([JSON.stringify(draftDocument(view, recovered, location.origin), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = recovered ? "team-canvas-recovered-draft.excalidraw" : "team-canvas-draft.excalidraw";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
