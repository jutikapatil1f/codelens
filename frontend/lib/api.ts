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

// ---------------------------------------------------------------------------
// Structured analysis result
//
// The backend stores the AI output as a JSON string in `Analysis.result`.
// These types describe that JSON and `parseResult` turns it back into an
// object the UI can render as cards. Anything that isn't our JSON shape (older
// rows, a model that ignored the contract) degrades to a single plain note.
// ---------------------------------------------------------------------------

export type FindingType = "bug" | "improvement" | "good";

export interface Finding {
  type: FindingType;
  line: number | null;
  title?: string;
  message: string;
  fix?: string | null;
}

export interface StructuredResult {
  summary?: string;
  findings: Finding[];
  complexity: { time: string; space: string };
}

// One turn in the follow-up conversation attached to an analysis.
export interface Message {
  id: string;
  analysisId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export function parseResult(raw: string | null): StructuredResult | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<StructuredResult>;
    if (Array.isArray(data.findings)) {
      return {
        summary: data.summary,
        findings: data.findings,
        complexity: data.complexity ?? { time: "—", space: "—" },
      };
    }
  } catch {
    /* not our JSON — fall through to the plain-text fallback */
  }
  // Legacy / unstructured output: show it as one improvement note.
  return {
    findings: [{ type: "improvement", line: null, message: raw }],
    complexity: { time: "—", space: "—" },
  };
}

// Derives a snippet display name from its code, mirroring the file-name look
// of the design (e.g. "binarySearch" → "binary-search.ts"). Falls back to a
// generic name when no symbol can be found.
const EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  java: "java",
  go: "go",
  rust: "rs",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  ruby: "rb",
  php: "php",
  sql: "sql",
};

export function snippetName(code: string, language: string): string {
  const ext = EXTENSIONS[language] ?? "txt";
  // First named function / class / def / const in the source.
  const match = code.match(
    /(?:function|class|def|struct|interface|fn)\s+([A-Za-z_]\w*)|(?:const|let|var)\s+([A-Za-z_]\w*)\s*=/,
  );
  const symbol = match?.[1] ?? match?.[2];
  if (!symbol) return `untitled.${ext}`;
  // camelCase / PascalCase → kebab-case.
  const kebab = symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();``
  return `${kebab}.${ext}`;
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

  listMessages: (token: string, id: string) =>
    request<Message[]>(`/analyses/${id}/messages`, { token }),

  // Ask a follow-up question. Resolves with the new question/answer pair once
  // the model has replied (this can take 30–90s on a local model).
  askFollowUp: (token: string, id: string, content: string) =>
    request<{ question: Message; answer: Message }>(
      `/analyses/${id}/messages`,
      { method: "POST", body: { content }, token },
    ),
};
