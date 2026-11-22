import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { MARKDOWN_LINK } from "./markdownCore";

export function createMarkdownElement(text: string, x: number, y: number, width = 420, height = 360, id?: string, color = "#ffffff"): ExcalidrawEmbeddableElement {
  const [base] = convertToExcalidrawElements([{ type: "rectangle", ...(id ? { id } : {}), x, y, width, height,
    backgroundColor: color, fillStyle: "solid", strokeColor: "#cbd5e1", roughness: 0 }], { regenerateIds: false });
  return { ...base, type: "embeddable", link: MARKDOWN_LINK, customData: { teamCanvasKind: "markdown", markdown: text } } as ExcalidrawEmbeddableElement;
}
