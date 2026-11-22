import type { BoardState } from "./protocol";
import { draftCapability } from "./draftCapability";

export interface CanvasObject {
  id: string; kind: string; text: string; x: number; y: number; width: number; height: number;
  textId: string | null; sourceId: string | null; targetId: string | null;
}
export interface AssistantCanvas {
  board: BoardState;
  scope: string;
  counts: { objects: number; notes: number; shapes: number; texts: number; connections: number; other: number; rawElements: number };
  objects: CanvasObject[];
}
export interface CanvasAction {
  type: "create_note" | "create_shape" | "create_text" | "connect" | "update_text";
  id: string; text: string; shape: "rectangle" | "ellipse" | "diamond"; color: string;
  sourceId: string | null; targetId: string | null; x: number; y: number; width: number; height: number;
}
export interface AssistantProposal {
  id: string; boardId: string; pageId: string; epoch: number; roundId: string | null;
  message: string; actions: CanvasAction[]; status: "pending" | "applied" | "dismissed";
}
export interface AssistantReply { message: string; referenceIds: string[]; proposal: AssistantProposal | null; canvas: AssistantCanvas | null; }

export async function assistantRequest<T>(board: BoardState, path: string, signal?: AbortSignal, body?: object, method = body ? "POST" : "GET"): Promise<T> {
  const response = await fetch(`/api/boards/${board.id}/assistant${path}`, {
    method, signal, cache: "no-store",
    headers: { "X-Requested-With": "JavaScript", ...(body ? { "Content-Type": "application/json" } : {}),
      ...(board.roundId ? { "X-Draft-Capability": draftCapability(board.id, board.roundId) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message ?? "The assistant request failed. Please try again.");
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
