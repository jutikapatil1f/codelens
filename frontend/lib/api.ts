// Thin typed wrapper around fetch for the CodeLens backend.
// Base URL comes from the env var (see frontend/.env); the JWT, when present,
// is attached as a Bearer token on every request.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type AnalysisStatus = "pending" | "processing" | "completed" | "failed";

export interface Analysis {
  id: string;
  userId: string;
  language: string;
  code: string;
  status: AnalysisStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
}

// Thrown for any non-2xx response, carrying the backend's message + status.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    // The backend sends { message } (string or string[]) on errors.
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = Array.isArray(data.message)
        ? data.message.join(", ")
        : (data.message ?? message);
    } catch {
      /* non-JSON error body — keep the default message */
    }
    throw new ApiError(message, res.status);
  }

  // 204/empty responses won't have a body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password },
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  createAnalysis: (token: string, code: string, language: string) =>
    request<Analysis>("/analyses", {
      method: "POST",
      body: { code, language },
      token,
    }),

  listAnalyses: (token: string) =>
    request<Analysis[]>("/analyses", { token }),

  getAnalysis: (token: string, id: string) =>
    request<Analysis>(`/analyses/${id}`, { token }),
};
