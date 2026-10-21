import { readFileSync } from "node:fs";

export const protocolEvents = JSON.parse(readFileSync(new URL("./fixtures/protocol.json", import.meta.url), "utf8"));

export function snapshot(poker = false) {
  return structuredClone(protocolEvents[poker ? 1 : 0].data);
}

export function canvas(overrides = {}) {
  return {
    id: snapshot().board.id,
    name: "Navigation canvas",
    owner: { id: "account", displayName: "Navigation test" },
    relationship: "owner",
    createdAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: null,
    templateVisibility: null,
    tags: [],
    ...overrides,
  };
}
