import type { ServerEvent } from "./protocol";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const role = (value: unknown) => value === "host" || value === "guest";
const board = (value: unknown) =>
  object(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.mode === "standard" || value.mode === "poker") &&
  (value.roundId === null || typeof value.roundId === "string") &&
  integer(value.epoch) &&
  integer(value.revision) &&
  typeof value.pageId === "string";
const pages = (value: unknown) =>
  Array.isArray(value) &&
  value.every((page) => object(page) && typeof page.id === "string" && integer(page.position));
const round = (value: unknown) => value === null || (object(value) && typeof value.id === "string");
const elements = (value: unknown) =>
  Array.isArray(value) &&
  value.length <= 4000 &&
  value.every(
    (element) =>
      object(element) &&
      typeof element.id === "string" &&
      typeof element.type === "string" &&
      ["x", "y", "width", "height"].every(
        (key) => typeof element[key] === "number" && Number.isFinite(element[key])
      )
  );

/** Reject incompatible server packets at the transport boundary, before touching the editor. */
export function parseServerEvent(text: string): ServerEvent {
  const value: unknown = JSON.parse(text);
  if (!object(value)) throw new Error("Invalid server event");
  let valid = false;
  switch (value.type) {
    case "metadata":
      valid = typeof value.name === "string" && value.name.length > 0 && value.name.length <= 120;
      break;
    case "pong":
      valid = true;
      break;
    case "snapshot": {
      const data = value.data;
      valid =
        object(data) &&
        board(data.board) &&
        round(data.round) &&
        elements(data.elements) &&
        strings(data.publicIds) &&
        strings(data.fileIds) &&
        pages(data.pages) &&
        strings(data.pokerCreatedIds) &&
        typeof data.participantId === "string" &&
        role(data.role);
      break;
    }
    case "patch":
      valid =
        typeof value.commandId === "string" &&
        integer(value.revision) &&
        (value.scope === "public" || value.scope === "private") &&
        elements(value.elements) &&
        strings(value.fileIds);
      break;
    case "ack":
      valid = typeof value.commandId === "string" && integer(value.revision);
      break;
    case "round":
      valid = board(value.board) && round(value.round);
      break;
    case "presence":
      valid =
        Array.isArray(value.participants) &&
        value.participants.length <= 10 &&
        value.participants.every(
          (person) =>
            object(person) &&
            typeof person.id === "string" &&
            typeof person.name === "string" &&
            role(person.role)
        );
      break;
    case "cursor":
      valid =
        typeof value.id === "string" &&
        typeof value.x === "number" &&
        Number.isFinite(value.x) &&
        typeof value.y === "number" &&
        Number.isFinite(value.y);
      break;
    case "error":
      valid =
        (value.commandId === null || typeof value.commandId === "string") &&
        typeof value.code === "string" &&
        typeof value.message === "string";
      break;
  }
  if (!valid) throw new Error("Incompatible server event");
  return value as ServerEvent;
}
