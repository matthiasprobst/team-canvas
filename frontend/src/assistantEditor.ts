import { convertToExcalidrawElements, CaptureUpdateAction, viewportCoordsToSceneCoords, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { AssistantProposal } from "./assistant";
import type { BoardState } from "./protocol";
import { createMarkdownElement } from "./markdownElement";
import { markdownSource } from "./markdownCore";

/** Compile allowlisted actions into native editable elements; the model never supplies scene JSON. */
export function compileAssistantProposal(editor: ExcalidrawImperativeAPI, proposal: AssistantProposal, board: BoardState) {
  if (proposal.status !== "pending" || proposal.boardId !== board.id || proposal.pageId !== board.pageId || proposal.epoch !== board.epoch || proposal.roundId !== board.roundId)
    throw new Error("This proposal belongs to an earlier page or poker round. Please ask again.");
  const current = editor.getSceneElementsIncludingDeleted();
  const live = new Map<string, ExcalidrawElement>(current.filter(element => !element.isDeleted).map(element => [element.id, element]));
  if (proposal.actions.some(action => action.type !== "update_text" && live.has(action.id)))
    throw new Error("This proposal has already been added to the canvas.");
  const app = editor.getAppState();
  const origin = viewportCoordsToSceneCoords({ clientX: app.offsetLeft + Math.min(app.width * 0.3, 320), clientY: app.offsetTop + Math.min(app.height * 0.3, 180) }, app);
  const additions = proposal.actions.filter(action => action.type.startsWith("create_"));
  if (additions.length) {
    const minX = Math.min(...additions.map(action => action.x));
    const maxX = Math.max(...additions.map(action => action.x + action.width));
    const minY = Math.min(...additions.map(action => action.y));
    const maxY = Math.max(...additions.map(action => action.y + action.height));
    // Move the whole proposed layout below intersecting objects, retaining its internal spacing.
    for (let attempt = 0; attempt < 100; attempt++) {
      const overlaps = [...live.values()].filter(element =>
        element.x < origin.x + maxX + 24 && element.x + element.width > origin.x + minX - 24 &&
        element.y < origin.y + maxY + 24 && element.y + element.height > origin.y + minY - 24);
      if (!overlaps.length) break;
      origin.y = Math.max(...overlaps.map(element => element.y + element.height)) + 40 - minY;
    }
  }
  const skeletons: ExcalidrawElementSkeleton[] = [];
  const markdownElements: ExcalidrawElement[] = [];
  for (const action of proposal.actions) {
    if (!action.type.startsWith("create_")) continue;
    const common = { id: action.id, x: origin.x + action.x, y: origin.y + action.y, strokeColor: "#334155" };
    if (action.type === "create_markdown") markdownElements.push(createMarkdownElement(action.text, common.x, common.y, action.width, action.height, action.id, action.color));
    else if (action.type === "create_text") skeletons.push({ ...common, type: "text", text: action.text, fontSize: 24 });
    else skeletons.push({ ...common, type: action.type === "create_note" ? "rectangle" : action.shape,
      width: action.width, height: action.height, backgroundColor: action.color, fillStyle: "solid",
      ...(action.type === "create_note" ? { strokeColor: "#b08900", customData: { teamCanvasKind: "note" } } : {}),
      ...(action.text ? { label: { ...{ id: `${action.id}_text` }, text: action.text, fontSize: 22, textAlign: "left", verticalAlign: "top" } } : {}),
    });
  }
  const created = [...convertToExcalidrawElements(skeletons, { regenerateIds: false }), ...markdownElements];
  created.forEach(element => live.set(element.id, element));
  const changes = new Map<string, ExcalidrawElement>(created.map(element => [element.id, element]));
  for (const action of proposal.actions) {
    if (action.type === "update_text") {
      const target = live.get(action.id);
      if (target && markdownSource(target) !== null) {
        if (target.locked) throw new Error("This note is locked.");
        const next = { ...target, customData: { teamCanvasKind: "markdown", markdown: action.text }, version: target.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 30) };
        changes.set(next.id, next);
        live.set(next.id, next);
        continue;
      }
      const textId = target?.type === "text" ? target.id : target?.boundElements?.find(binding => binding.type === "text")?.id;
      const text = textId ? live.get(textId) : undefined;
      if (!text || text.type !== "text" || text.locked || target?.locked) throw new Error("The text is unavailable or locked. Please regenerate this proposal.");
      const next = { ...text, text: action.text, originalText: action.text, autoResize: false, version: text.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 30) };
      changes.set(next.id, next);
      live.set(next.id, next);
      if (target && target.type !== "text") changes.set(target.id, { ...target, version: target.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 30) });
    }
    if (action.type !== "connect") continue;
    const source = action.sourceId ? live.get(action.sourceId) : undefined;
    const target = action.targetId ? live.get(action.targetId) : undefined;
    if (!source || !target || source.locked || target.locked) throw new Error("A connection endpoint is unavailable or locked. Please regenerate this proposal.");
    const from = { x: source.x + source.width, y: source.y + source.height / 2 };
    const to = { x: target.x, y: target.y + target.height / 2 };
    const arrows = convertToExcalidrawElements([{ id: action.id, type: "arrow", x: from.x, y: from.y,
      points: [[0, 0], [to.x - from.x, to.y - from.y]], strokeColor: "#475569", endArrowhead: "arrow",
      startBinding: { elementId: source.id, focus: 0, gap: 1 }, endBinding: { elementId: target.id, focus: 0, gap: 1 },
      ...(action.text ? { label: { ...{ id: `${action.id}_text` }, text: action.text, fontSize: 18 } } : {}),
    }], { regenerateIds: false });
    arrows.forEach(element => changes.set(element.id, element.type === "arrow" ? {
      ...element,
      startBinding: { elementId: source.id, focus: 0, gap: 1 },
      endBinding: { elementId: target.id, focus: 0, gap: 1 },
    } : element));
    for (const endpoint of [source, target]) {
      const next = { ...endpoint, boundElements: [...(endpoint.boundElements ?? []), { id: action.id, type: "arrow" as const }],
        version: endpoint.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 30) };
      changes.set(next.id, next);
      live.set(next.id, next);
    }
  }
  if (changes.size > 50 || JSON.stringify([...changes.values()]).length > 250_000) throw new Error("This proposal is too large. Ask for fewer objects.");
  const elements = current.map(element => changes.get(element.id) ?? element);
  for (const element of changes.values()) if (!current.some(existing => existing.id === element.id)) elements.push(element);
  if (proposal.actions.some(action => action.type === "update_text")) {
    const refreshed = new Map(restoreElements(elements, null, { refreshDimensions: true, repairBindings: true }).map(element => [element.id, element]));
    for (let index = 0; index < elements.length; index++) if (changes.has(elements[index].id)) elements[index] = refreshed.get(elements[index].id) ?? elements[index];
  }
  return { elements, createdIds: [...changes.keys()] };
}

export function showAssistantObjects(editor: ExcalidrawImperativeAPI, ids: string[]) {
  const elements = editor.getSceneElements().filter(element => ids.includes(element.id));
  if (!elements.length) return;
  const app = editor.getAppState();
  const minX = Math.min(...elements.map(element => element.x)), minY = Math.min(...elements.map(element => element.y));
  const maxX = Math.max(...elements.map(element => element.x + element.width)), maxY = Math.max(...elements.map(element => element.y + element.height));
  const leftMargin = app.width > 700 ? 240 : 0;
  const availableWidth = Math.max(150, app.width - (app.width > 700 ? 420 : 20) - leftMargin);
  const zoom = Math.max(0.1, Math.min(1, availableWidth / (maxX - minX + 100), Math.max(100, app.height - 80) / (maxY - minY + 100))) as typeof app.zoom.value;
  editor.updateScene({ appState: {
    selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])), zoom: { value: zoom },
    scrollX: (leftMargin + availableWidth / 2) / zoom - (minX + maxX) / 2,
    scrollY: app.height / 2 / zoom - (minY + maxY) / 2,
  }, captureUpdate: CaptureUpdateAction.NEVER });
}
