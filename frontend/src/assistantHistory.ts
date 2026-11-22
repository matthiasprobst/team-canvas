import type { AssistantProposal } from "./assistant";

export interface HistoryTurn { role: "user" | "assistant"; content: string; }

/** Saved proposals are durable activity, not a complete transcript of prior chats. */
export function assistantHistory(messages: HistoryTurn[], summary: string, proposals: AssistantProposal[], includeSaved: boolean, compact: boolean): HistoryTurn[] {
  const saved = includeSaved && !summary ? proposals.filter(proposal => proposal.status !== "dismissed").slice(0, 12) : [];
  const activity = saved.length ? "Saved proposal activity (not a complete conversation transcript):\n" + saved.map(proposal =>
    `${proposal.status.toUpperCase()} — ${proposal.message.slice(0, 400)}\n` + proposal.actions.map(action =>
      `${action.type} ${action.id}: ${action.text.slice(0, 180)}`).join("\n").slice(0, 1200)).join("\n\n") : "";
  const memory = summary || activity.slice(0, 8000);
  return [
    ...(memory ? [{ role: "assistant" as const, content: memory }] : []),
    ...messages.filter(message => message.content !== summary).slice(-(compact ? 24 : memory ? 11 : 12))
      .map(({ role, content }) => ({ role, content: content.slice(0, 8000) })),
  ];
}
