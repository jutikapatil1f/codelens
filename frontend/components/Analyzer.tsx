"use client";

// The authenticated experience: write code in the Monaco editor, submit it,
// then poll the backend until the background worker finishes the analysis.
// Past analyses are listed on the right and can be reopened.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, ApiError, type Analysis } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

// Monaco touches `window`, so load it client-side only (no SSR).
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Loading editor…
    </div>
  ),
});

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "sql",
];

const STARTER = `function add(a, b) {\n  return a - b;\n}`;

// How a status renders as a colored pill.
const STATUS_STYLES: Record<Analysis["status"], string> = {
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  processing: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
};

export function Analyzer() {
  const { token } = useAuth();
  const [code, setCode] = useState(STARTER);
  const [language, setLanguage] = useState("javascript");
  const [current, setCurrent] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      setHistory(await api.listAnalyses(token));
    } catch {
      /* non-fatal: history just won't refresh */
    }
  }, [token]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Poll the current analysis until it leaves a non-terminal state.
  useEffect(() => {
    const clear = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    if (!token || !current) return clear();
    if (current.status === "completed" || current.status === "failed") {
      clear();
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.getAnalysis(token, current.id);
        setCurrent(fresh);
        if (fresh.status === "completed" || fresh.status === "failed") {
          clear();
          loadHistory();
        }
      } catch {
        /* transient (the API can be CPU-starved during inference) — keep polling */
      }
    }, 2500);

    return clear;
  }, [token, current, loadHistory]);

  async function handleAnalyze() {
    if (!token || !code.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.createAnalysis(token, code, language);
      setCurrent(created); // status: 'pending' — the poll effect takes over
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  function openFromHistory(item: Analysis) {
    setCurrent(item);
    setCode(item.code);
    setLanguage(item.language);
  }

  const busy =
    current?.status === "pending" || current?.status === "processing";

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
      {/* Left: editor + result */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/15"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l} className="dark:bg-zinc-900">
                {l}
              </option>
            ))}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={submitting || busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : busy ? "Analyzing…" : "Analyze"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        <div className="h-80 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
          <MonacoEditor
            height="100%"
            language={language}
            value={code}
            onChange={(v) => setCode(v ?? "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
            }}
          />
        </div>

        {/* Result panel */}
        <div className="min-h-40 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900">
          {!current ? (
            <p className="text-sm text-zinc-500">
              Submit some code and the AI analysis will appear here.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[current.status]}`}
                >
                  {current.status}
                </span>
                {busy && (
                  <span className="text-xs text-zinc-500">
                    Running on a local model — this can take 30–90s.
                  </span>
                )}
              </div>
              {current.status === "failed" ? (
                <p className="text-sm text-red-600">{current.error}</p>
              ) : current.result ? (
                <pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-relaxed">
                  {current.result}
                </pre>
              ) : (
                <p className="text-sm text-zinc-500">Waiting for the worker…</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right: history */}
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            History
          </h2>
          <button
            onClick={loadHistory}
            className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <p className="px-1 text-sm text-zinc-500">No analyses yet.</p>
        ) : (
          history.map((item) => (
            <button
              key={item.id}
              onClick={() => openFromHistory(item)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                current?.id === item.id
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                  : "border-black/10 hover:bg-black/3 dark:border-white/10 dark:hover:bg-white/4"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{item.language}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[item.status]}`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                {item.code.replace(/\s+/g, " ").slice(0, 50)}
              </p>
            </button>
          ))
        )}
      </aside>
    </div>
  );
}
