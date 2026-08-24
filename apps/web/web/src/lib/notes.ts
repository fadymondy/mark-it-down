// Warehouse notes client — /api/notes is user-scoped by the backend (session
// cookie or bearer PAT); /api/shared/{slug} is the public share endpoint.
import { API } from "./api";

export interface Note {
  id: string;
  title: string;
  body: string;
  category: string | null;
  tags: string | null;
  user_id: string;
  share_slug: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface SharedNote { title: string; body: string; html: string; updated_at: string }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).detail || (data as any).error || `request failed (${res.status})`);
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const notesApi = {
  list: (opts: { q?: string; category?: string; tag?: string } = {}): Promise<Note[]> => {
    const p = new URLSearchParams();
    if (opts.q) p.set("q", opts.q);
    if (opts.category) p.set("category", opts.category);
    if (opts.tag) p.set("tag", opts.tag);
    const qs = p.toString();
    return req(`/api/notes${qs ? `?${qs}` : ""}`);
  },
  get: (id: string): Promise<Note> => req(`/api/notes/${id}`),
  create: (n: { title: string; body: string; category?: string | null; tags?: string | null }): Promise<Note> =>
    req("/api/notes", json("POST", n)),
  update: (id: string, n: { title: string; body: string; category?: string | null; tags?: string | null }): Promise<Note> =>
    req(`/api/notes/${id}`, json("PUT", n)),
  remove: (id: string): Promise<void> => req(`/api/notes/${id}`, json("DELETE")),
  share: (id: string): Promise<Note> => req(`/api/notes/${id}/share`, json("POST")),
  unshare: (id: string): Promise<Note> => req(`/api/notes/${id}/share`, json("DELETE")),
  shared: (slug: string): Promise<SharedNote> => req(`/api/shared/${slug}`),
};

export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}
