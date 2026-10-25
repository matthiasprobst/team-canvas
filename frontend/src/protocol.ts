export interface ElementData {
  id: string;
  type: string;
  isDeleted?: boolean;
  index?: string | null;
  [key: string]: unknown;
}
export interface BinaryFile {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
  lastRetrieved?: number;
}
export type Files = Record<string, BinaryFile>;
export interface BoardState {
  id: string;
  name: string;
  mode: "standard" | "poker";
  roundId: string | null;
  epoch: number;
  revision: number;
  pageId: string;
}
export interface CanvasSheet {
  id: string;
  position: number;
}
export interface RoundState { id: string; }
export interface Snapshot {
  board: BoardState;
  round: RoundState | null;
  elements: ElementData[];
  publicIds: string[];
  fileIds: string[];
  pages: CanvasSheet[];
  pokerCreatedIds: string[];
  participantId: string;
  role: "host" | "guest";
}
export interface Presence {
  id: string;
  name: string;
  role: "host" | "guest";
}
export interface CommandContext {
  commandId: string;
  epoch: number;
  roundId: string | null;
  pageId: string;
}
export type ControlType = "start_round" | "stop_round";
export type PageAction =
  | { type: "create_page"; copyCurrent: boolean; includePoker: boolean }
  | { type: "select_page"; targetPageId: string };
export type BoardCommand = CommandContext &
  (
    | { type: "patch"; elements: ElementData[]; files: Files }
    | { type: ControlType }
    | PageAction
  );
export type PatchEvent = {
  type: "patch";
  commandId: string;
  revision: number;
  scope: "public" | "private";
  elements: ElementData[];
  fileIds: string[];
};
export type ServerEvent =
  | { type: "pong" }
  | { type: "metadata"; name: string }
  | { type: "snapshot"; data: Snapshot }
  | PatchEvent
  | { type: "ack"; commandId: string; revision: number }
  | { type: "round"; board: BoardState; round: RoundState | null }
  | { type: "presence"; participants: Presence[]; connections: number }
  | { type: "cursor"; id: string; x: number; y: number }
  | { type: "error"; commandId: string | null; code: string; message: string };
