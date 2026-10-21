/** Private recovery secrets never enter a URL or persistent account record. */
export function draftCapability(boardId: string, roundId: string): string {
  const key = `poker-draft:${boardId}:${roundId}`;
  let secret = sessionStorage.getItem(key);
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    sessionStorage.setItem(key, secret);
  }
  return secret;
}

export function forgetDraftCapability(boardId: string, roundId: string) {
  sessionStorage.removeItem(`poker-draft:${boardId}:${roundId}`);
}
