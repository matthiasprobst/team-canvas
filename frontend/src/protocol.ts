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
}
export interface RoundMember { id: string; name: string; done: boolean }
export interface RoundState {
  id: string;
  done: boolean;
  included: boolean;
  draftRevision: number;
  members: RoundMember[];
}
export interface AvatarMarker { id: string; userId: string; name: string; avatarVersion: number; hasAvatar: boolean; x: number; y: number }
export interface Snapshot {
  board: BoardState;
  round: RoundState | null;
  elements: ElementData[];
  publicIds: string[];
  fileIds: string[];
  participantId: string;
  role: "host" | "guest";
  avatars: AvatarMarker[];
}
export interface Presence { id: string; name: string; role: "host" | "guest" }
export interface CommandContext { commandId: string; epoch: number; roundId: string | null }
export type ControlType = "start_round" | "done" | "cancel_round";
export type BoardCommand = CommandContext & (
  | { type: "patch"; elements: ElementData[]; files: Files }
  | { type: ControlType; draftRevision?: number }
);
export type PatchEvent = {
  type: "patch";
  commandId: string;
  revision: number;
  actorId: string;
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
  | { type: "presence"; participants: Presence[] }
  | { type: "cursor"; id: string; x: number; y: number }
  | { type: "avatar_state"; avatars: AvatarMarker[] }
  | { type: "error"; commandId: string | null; code: string; message: string };
