// togo auth client — talks to the auth plugin's /api/auth/* endpoints.
// Session is an HttpOnly cookie; CSRF uses the double-submit token.
import { API } from "./api";

async function csrf(): Promise<string> {
  const res = await fetch(`${API}/api/auth/csrf`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  return data.csrf_token ?? "";
}

async function post<T = any>(path: string, body?: unknown): Promise<T> {
  const token = await csrf();
  const res = await fetch(`${API}/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `request failed (${res.status})`);
  return data as T;
}

export interface Me { id?: string; email: string; roles?: string[]; permissions?: string[]; [k: string]: unknown }

export const auth = {
  login: (email: string, password: string) => post("login", { email, password }),
  register: (email: string, password: string) => post("register", { email, password }),
  logout: () => post("logout"),
  me: async (): Promise<Me | null> => {
    const res = await fetch(`${API}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return res.json();
  },
  methods: async (): Promise<{ name: string; label: string; type: string; url: string }[]> => {
    const res = await fetch(`${API}/api/auth/methods`, { credentials: "include" }).catch(() => null);
    if (!res || !res.ok) return [];
    const d = await res.json().catch(() => ({ methods: [] }));
    return d.methods ?? [];
  },
  requestOtp: (email: string, purpose = "reset") => post("otp", { email, purpose }),
  verifyOtp: (email: string, code: string, purpose = "reset") => post("otp/verify", { email, code, purpose }),
  changePassword: (current: string, next: string) => post("change-password", { current_password: current, new_password: next }),
};

// ---- 2FA (app-level challenge login + auth-mfa factor routes) ----

export interface MfaLoginResult { mfa_required?: boolean; challenge?: string; token?: string; user?: Me }

async function jsonFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `request failed (${res.status})`);
  return data as T;
}

const postJSON = (path: string, body?: unknown) =>
  jsonFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

export const mfa = {
  // Login that gates on 2FA: {token,user} when no factor, {mfa_required,challenge} otherwise.
  login: (email: string, password: string): Promise<MfaLoginResult> =>
    postJSON("/api/auth/mfa-login", { email, password }),
  // Complete the challenge with a TOTP code (also used to activate a new factor).
  totpVerify: (args: { challenge?: string; userId?: string; code: string }) =>
    postJSON("/api/auth/mfa/totp/verify", { Challenge: args.challenge, UserID: args.userId, Code: args.code }),
  recoveryVerify: (challenge: string, code: string) =>
    postJSON("/api/auth/mfa/recovery/verify", { Challenge: challenge, Code: code }),
  // Self-service (session required; the server pins the subject to the caller).
  status: (): Promise<{ enrolled: boolean }> => jsonFetch("/api/auth/mfa-status"),
  enroll: (): Promise<{ secret: string; otpauth_url: string }> => postJSON("/api/auth/mfa/totp/enroll"),
  disable: () => postJSON("/api/auth/mfa/totp/disable"),
  recoveryGenerate: (): Promise<{ codes: string[] }> => postJSON("/api/auth/mfa/recovery/generate"),
};

// ---- Personal access tokens (bearer auth for MCP clients, Chrome extension, CLI) ----

export interface PatMeta { id: string; name: string; abilities: string[]; created_at?: string }

export const tokens = {
  list: (): Promise<PatMeta[]> => jsonFetch("/api/auth/tokens").then((d: any) => d.tokens ?? d ?? []),
  create: async (name: string): Promise<{ token: string; name: string }> =>
    jsonFetch("/api/auth/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({ name, abilities: ["*"] }),
    }),
  revoke: async (id: string) =>
    jsonFetch(`/api/auth/tokens/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": await csrf() } }),
};

// Session cache so the router's beforeLoad guards resolve /me once per navigation
// pass instead of re-fetching on every route. Clear it after login/logout/register.
let _meCache: Promise<Me | null> | null = null;
export function sessionMe(force = false): Promise<Me | null> {
  if (force || !_meCache) _meCache = auth.me();
  return _meCache;
}
export function clearSession() { _meCache = null; }
