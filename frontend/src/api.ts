import type { BinaryFile } from "./protocol";

export interface Identity { id: string; participantId: string; role: "host" | "guest"; token: string }

async function checked(response: Response): Promise<Response> {
  if (response.status === 499 || (response.status === 401 && response.headers.has("WWW-Authenticate"))) {
    // A top-level navigation can complete the corporate OIDC flow without a cross-origin fetch redirect.
    if (!sessionStorage.getItem("login-attempt")) {
      sessionStorage.setItem("login-attempt", "1");
      location.assign(`/api/login?return=${encodeURIComponent(location.pathname)}`);
    }
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new Error(data.message ?? `HTTP ${response.status}`);
  }
  sessionStorage.removeItem("login-attempt");
  return response;
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await checked(await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "JavaScript" }, body: JSON.stringify(body),
  }));
  return response.json() as Promise<T>;
}

export function createBoard(name: string): Promise<{ id: string; hostKey: string; inviteKey: string }> {
  return post("/api/boards", { name });
}

export function joinBoard(id: string, name: string, token: string | null, hostKey: string | null, inviteKey: string | null): Promise<Identity> {
  return post(`/api/boards/${encodeURIComponent(id)}/join`, { name, token, hostKey, inviteKey });
}

export async function fetchAsset(boardId: string, assetId: string, token: string, signal?: AbortSignal): Promise<BinaryFile> {
  const response = await checked(await fetch(`/api/boards/${boardId}/assets/${encodeURIComponent(assetId)}`, {
    headers: { "X-Board-Token": token, "X-Requested-With": "JavaScript" }, signal,
  }));
  return response.json() as Promise<BinaryFile>;
}

export function rotateInvitation(boardId: string, token: string, revokeGuests: boolean): Promise<{ inviteKey: string }> {
  return post(`/api/boards/${boardId}/invitations`, { token, revokeGuests });
}

export async function checkCompanySession(): Promise<void> {
  await checked(await fetch("/api/session", { cache: "no-store", headers: { "X-Requested-With": "JavaScript" } }));
}
