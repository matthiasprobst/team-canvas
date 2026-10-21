/** Fragment secrets are stored locally before sign-in and never enter a server URL. */
export function preserveInvitation() {
  const match = location.pathname.match(/^\/b\/([a-f0-9-]{36})$/i);
  if (!match || !location.hash) return;
  const key = new URLSearchParams(location.hash.slice(1)).get("invite");
  if (key && key.length <= 128) sessionStorage.setItem(`invitation:${match[1]}`, key);
  window.history.replaceState(window.history.state, "", location.pathname);
}
