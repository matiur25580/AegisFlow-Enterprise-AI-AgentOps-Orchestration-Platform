const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/+$/, "");

export type ApiError = Error & { status?: number; code?: string };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken);
  const response = await fetch(API_BASE + path, {
    ...options,
    headers,
    credentials: "include"
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as {
    data?: T;
    error?: { code?: string; message?: string; fields?: Record<string, string[]> };
  };
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "Request failed (" + response.status + ")") as ApiError;
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data as T;
}

let refreshPromise: Promise<{ accessToken: string }> | null = null;

export function refreshAccessToken(): Promise<{ accessToken: string }> {
  if (!refreshPromise) {
    refreshPromise = apiRequest<{ accessToken: string }>("/auth/refresh", { method: "POST" })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
