import type { BinaryFile } from "./protocol";
export interface Identity { id: string; participantId: string; role: "host" | "guest"; token: string }
export interface Account { id: string; displayName: string }
export interface Canvas { id: string; name: string; owner: Account; relationship: "owner" | "member"; createdAt: string; lastOpenedAt: string | null }
export interface CanvasPage { items: Canvas[]; nextCursor: string | null }
export class ApiError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
export async function request<T>(path: string, body?: object, method = "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body ? method : "GET", signal, cache: "no-store",
    headers: { "X-Requested-With": "JavaScript", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.message ?? (response.status === 499 || response.status === 401 ? "Please sign in to continue." : "The request failed. Please try again."), response.status);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export const me = (signal?: AbortSignal) => request<Account>("/api/me", undefined, "GET", signal);
export const createBoard = (name: string) => request<{ id: string; name: string }>("/api/boards", { name });
export const joinBoard = (id: string, inviteKey?: string) => request<Identity>(`/api/boards/${id}/join`, { inviteKey });
export const renameBoard = (id: string, name: string) => request<{ name: string }>(`/api/boards/${id}`, { name }, "PATCH");
export const createInvitation = (id: string) => request<{ inviteKey: string }>(`/api/boards/${id}/invitations`, {});
export const previewInvitation = (id: string, inviteKey: string, signal?: AbortSignal) => request<{ name: string; ownerName: string }>(`/api/boards/${id}/invitations/preview`, { inviteKey }, "POST", signal);
export const revokeInvitations = (id: string, revokeMembers: boolean) => request<void>(`/api/boards/${id}/invitations/revoke`, { revokeMembers });
export async function fetchAsset(boardId: string, assetId: string, token: string, signal?: AbortSignal): Promise<BinaryFile> {
  const response = await fetch(`/api/boards/${boardId}/assets/${encodeURIComponent(assetId)}`, { headers: { "X-Board-Token": token, "X-Requested-With": "JavaScript" }, signal });
  if (!response.ok) throw new Error("Could not load image. Please check your connection and sign-in session.");
  return response.json() as Promise<BinaryFile>;
}
export async function checkCompanySession(): Promise<void> { await me(); }
export function signIn() { location.assign(`/api/login?return=${encodeURIComponent(/^\/b\/[a-f0-9-]{36}$/i.test(location.pathname) ? location.pathname : "/")}`); }
