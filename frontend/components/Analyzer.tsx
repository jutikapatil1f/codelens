"use client";

// The authenticated experience, styled as a single floating "CodeLens" window:
//   ┌ top bar: logo · breadcrumb · share · avatar ──────────────┐
//   │ snippets │           code editor          │  AI analysis  │
//   └ bottom bar: language · model · stats · analyze ───────────┘
// You write code in the Monaco editor, submit it, then poll the backend until
// the background worker finishes. Past analyses populate the snippets rail.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import {
  api,
  ApiError,
  parseResult,
  snippetName,
  type Analysis,
  type Finding,
  type Message,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { printAnalysisReport } from "@/lib/report";
import { usePresence } from "@/lib/use-presence";
import { ShareDialog } from "@/components/ShareDialog";

// Monaco touches `window`, so load it client-side only (no SSR).
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-faint">
      Loading editor…
    </div>
  ),
});

const LANGUAGES = [
  "typescript",
  "javascript",
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

const STARTER = `// finds the index of target in a sorted array
function binarySearch(arr: number[], target: number) {
  let low = 0;
  let high = arr.length;
  while (low <= high) {
    const mid = (low + high) / 2;
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}`;

// ── small inline icons (kept here so the file is self-contained) ─────────────
function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="white" strokeWidth="2">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.5" fill="white" stroke="none" />
        <line x1="12" y1="4" x2="12" y2="9" />
        <line x1="12" y1="15" x2="12" y2="20" />
        <line x1="4" y1="12" x2="9" y2="12" />
        <line x1="15" y1="12" x2="20" y2="12" />
      </svg>
    </span>
  );
}

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7 M16 6l-4-4-4 4 M12 2v14",
  plus: "M12 5v14 M5 12h14",
  bug: "M12 3l9 16H3z M12 9v4 M12 17h.01",
  bulb: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  check: "M20 6 9 17l-5-5",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  play: "M6 4l14 8-14 8z",
  chevron: "M6 9l6 6 6-6",
  sun: "M12 3v2 M12 19v2 M5 5l1.5 1.5 M17.5 17.5L19 19 M3 12h2 M19 12h2 M5 19l1.5-1.5 M17.5 6.5L19 5 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
};

// Per-finding visual treatment.
const FINDING_STYLE: Record<
  Finding["type"],
  { label: string; icon: string; box: string; head: string }
> = {
  bug: {
    label: "bug",
    icon: ICONS.bug,
    box: "border-amber-500/25 bg-amber-500/[0.08]",
    head: "text-amber-600 dark:text-amber-300",
  },
  improvement: {
    label: "improvement",
    icon: ICONS.bulb,
    box: "border-blue-500/25 bg-blue-500/[0.08]",
    head: "text-blue-600 dark:text-blue-300",
  },
  good: {
    label: "looks good",
    icon: ICONS.check,
    box: "border-emerald-500/25 bg-emerald-500/[0.08]",
    head: "text-emerald-600 dark:text-emerald-300",
  },
};

// Per-language accent for the little file-type badges in the rail.
const LANG_BADGE: Record<string, string> = {
  typescript: "bg-blue-500/20 text-blue-300",
  javascript: "bg-yellow-500/20 text-yellow-300",
  python: "bg-sky-500/20 text-sky-300",
  go: "bg-cyan-500/20 text-cyan-300",
  rust: "bg-orange-500/20 text-orange-300",
  java: "bg-red-500/20 text-red-300",
};
const EXT: Record<string, string> = {
  typescript: "TS",
  javascript: "JS",
  python: "PY",
  java: "JV",
  go: "GO",
  rust: "RS",
  c: "C",
  cpp: "C+",
  csharp: "C#",
  ruby: "RB",
  php: "PHP",
  sql: "SQL",
};

// Renders a message with `inline code` spans highlighted, like the design.
function renderMessage(message: string) {
  return message.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={i}
        className="rounded bg-elev2 px-1 py-0.5 font-mono text-[0.85em] text-fg"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// Decodes the email from the JWT (best-effort) for the avatar initials.
function initialsFromToken(token: string | null): string {
  if (!token) return "ME";
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { email?: string };
    const local = payload.email?.split("@")[0] ?? "";
    const parts = local.split(/[.\-_]/).filter(Boolean);
    const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
    return letters.toUpperCase() || "ME";
  } catch {
    return "ME";
  }
}

// The user id (JWT `sub`) — used to tell owned snippets from shared ones.
function userIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// A friendly display name from the JWT email (e.g. "jutika.patil" → "Jutika").
function displayNameFromToken(token: string | null): string {
  if (!token) return "You";
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { email?: string };
    const first = (payload.email?.split("@")[0] ?? "").split(/[.\-_]/)[0] ?? "";
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : "You";
  } catch {
    return "You";
  }
}

export function Analyzer() {
  const { token, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [code, setCode] = useState(STARTER);
  const [language, setLanguage] = useState("typescript");
  const [current, setCurrent] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [asking, setAsking] = useState(false);
  const [sharedWithMe, setSharedWithMe] = useState<Analysis[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);

  // Applied when a collaborator pushes new content over the presence socket:
  // sync the editor + every list that may hold this snippet, preserving our own
  // access level (the broadcast may not carry it), and drop any local dirty flag.
  const handleRemoteContent = useCallback((analysis: Analysis) => {
    const mergeAccess = (item: Analysis) => ({
      ...analysis,
      access: analysis.access ?? item.access,
    });
    setCurrent((prev) => {
      if (prev?.id !== analysis.id) return prev;
      return mergeAccess(prev);
    });
    setHistory((items) =>
      items.map((item) => (item.id === analysis.id ? mergeAccess(item) : item)),
    );
    setSharedWithMe((items) =>
      items.map((item) => (item.id === analysis.id ? mergeAccess(item) : item)),
    );
    setCode(analysis.code);
    setLanguage(analysis.language);
    setHasUnsavedEdits(false);
  }, []);

  // Live "who's viewing" for the open snippet.
  const {
    viewers,
    editor,
    editMessage,
    beginEditing,
    stopEditing,
    saveContent,
  } = usePresence(token, current?.id ?? null, handleRemoteContent);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Monaco handles. Stored on mount so findings can drive the editor: jump to a
  // line, paint gutter markers, and bind Cmd/Ctrl+Enter to analyze.
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const findingDecoRef = useRef<string[]>([]); // gutter markers
  // Latest analyze handler, so the Monaco keybinding never calls a stale closure.
  const analyzeRef = useRef<() => void>(() => {});

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      setHistory(await api.listAnalyses(token));
    } catch {
      /* non-fatal: history just won't refresh */
    }
    try {
      setSharedWithMe(await api.listSharedWithMe(token));
    } catch {
      /* non-fatal: shared list just won't refresh */
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
    if (
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "stale"
    ) {
      clear();
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api.getAnalysis(token, current.id);
        setCurrent(fresh);
        if (
          fresh.status === "completed" ||
          fresh.status === "failed" ||
          fresh.status === "stale"
        ) {
          clear();
          loadHistory();
        }
      } catch {
        /* transient (the API can be CPU-starved during inference) — keep polling */
      }
    }, 2500);

    return clear;
  }, [token, current, loadHistory]);

  // Load the follow-up thread whenever a completed analysis is in view.
  useEffect(() => {
    if (!token || !current || current.status !== "completed") {
      setMessages([]);
      return;
    }
    let active = true;
    api
      .listMessages(token, current.id)
      .then((msgs) => active && setMessages(msgs))
      .catch(() => active && setMessages([]));
    return () => {
      active = false;
    };
  }, [token, current?.id, current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAnalyze() {
    if (!token || !code.trim() || submitting || !canEditSnippet) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = current
        ? await api.reanalyze(token, current.id)
        : await api.createAnalysis(token, code, language);
      setCurrent(created); // status: 'pending' — the poll effect takes over
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  // Switch the open snippet from the rail. Release any editor lock we held on
  // the previous snippet before loading the selected one into the editor.
  function openFromHistory(item: Analysis) {
    stopEditing();
    setCurrent(item);
    setCode(item.code);
    setLanguage(item.language);
    setHasUnsavedEdits(false);
  }

  // Reset to a blank, unsaved snippet (no `current`, so analyze will create one).
  function newSnippet() {
    stopEditing();
    setCurrent(null);
    setError(null);
    setCode("");
    setMessages([]);
    setFollowUp("");
    setHasUnsavedEdits(false);
  }

  // "Download PDF": render the completed analysis to a printable report.
  function handleShare() {
    if (!current || !structured) return;
    printAnalysisReport({
      fileName: snippetName(current.code, current.language),
      language: current.language,
      code: current.code,
      createdAt: current.createdAt,
      author: displayNameFromToken(token),
      id: current.id,
      summary: structured.summary,
      findings: structured.findings,
      complexity: structured.complexity,
    });
  }

  async function handleFollowUp(e: React.FormEvent) {
    e.preventDefault();
    const content = followUp.trim();
    if (!token || !current || !content || asking || !canEditSnippet) return;
    setAsking(true);
    setError(null);
    // Optimistically show the question while the model thinks.
    const pending: Message = {
      id: "pending",
      analysisId: current.id,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, pending]);
    setFollowUp("");
    try {
      const { question, answer } = await api.askFollowUp(
        token,
        current.id,
        content,
      );
      setMessages((m) => [
        ...m.filter((x) => x.id !== "pending"),
        question,
        answer,
      ]);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== "pending"));
      setFollowUp(content); // restore so the question isn't lost
      setError(err instanceof ApiError ? err.message : "Follow-up failed");
    } finally {
      setAsking(false);
    }
  }

  const busy = current?.status === "pending" || current?.status === "processing";
  const structured = useMemo(
    () => (current?.status === "completed" ? parseResult(current.result) : null),
    [current],
  );

  // Keep the keybinding pointing at the current analyze handler.
  useEffect(() => {
    analyzeRef.current = handleAnalyze;
  });

  // Paint a colored gutter marker on each finding's line. Re-runs whenever the
  // analysis changes; passing [] clears the markers.
  const applyFindingDecorations = useCallback((findings: Finding[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const decos = findings
      .filter((f) => f.line != null)
      .map((f) => ({
        range: new monaco.Range(f.line!, 1, f.line!, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: `cl-gutter cl-gutter-${f.type}`,
        },
      }));
    findingDecoRef.current = editor.deltaDecorations(findingDecoRef.current, decos);
  }, []);

  useEffect(() => {
    applyFindingDecorations(structured?.findings ?? []);
  }, [structured, applyFindingDecorations]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Cmd/Ctrl+Enter → analyze, from anywhere in the editor.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      analyzeRef.current(),
    );
    editor.onDidFocusEditorText(() => beginEditing());
    applyFindingDecorations(structured?.findings ?? []);
  };

  // First local change to a saved snippet: grab the edit lock (so others see
  // we're editing and can't take it) and flag the buffer dirty.
  function markEditing() {
    if (!current || !canEditSnippet || isLockedByOther) return;
    beginEditing();
    setHasUnsavedEdits(true);
  }

  function handleCodeChange(nextCode: string) {
    if (isReadOnly) return;
    setCode(nextCode);
    if (current) markEditing();
  }

  function handleLanguageChange(nextLanguage: string) {
    if (isReadOnly) return;
    setLanguage(nextLanguage);
    if (current) markEditing();
  }

  // Commit local edits: broadcast + persist via the socket, which also releases
  // our lock so collaborators can edit next.
  function handleSaveEdits() {
    if (!current || !canEditSnippet || isLockedByOther || !hasUnsavedEdits) {
      return;
    }
    saveContent(code, language);
    setHasUnsavedEdits(false);
  }

  // ── derived state: identity, permissions and the editor lock ───────────────
  // Recomputed every render from `current` + the live presence `editor`. These
  // gate whether the editor is writable and what the footer/lock UI shows.
  const fileName = current
    ? snippetName(current.code, current.language)
    : snippetName(code, language);
  const lineCount = code ? code.split("\n").length : 0;
  const charCount = code.length;
  const currentUserId = userIdFromToken(token);
  const isOwner = !!current && current.userId === currentUserId;
  const isSharedSnippet = !!current && !isOwner;
  // Owner can always edit; a shared snippet needs explicit "edit" access. A new
  // (unsaved) snippet is editable too.
  const canEditSnippet = !current || isOwner || current.access === "edit";
  // Someone *else* holds the live edit lock (we ignore our own lock here).
  const activeOtherEditor =
    editor && editor.userId !== currentUserId ? editor : null;
  const isLockedByOther = !!activeOtherEditor;
  // Read-only if we lack edit rights, or another person currently has the lock.
  const isReadOnly = !!current && (!canEditSnippet || isLockedByOther);
  // Most specific reason first: someone editing > view-only access > generic
  // presence message (e.g. "X saved edits").
  const lockMessage = activeOtherEditor
    ? `${activeOtherEditor.name} is editing`
    : isSharedSnippet && current?.access !== "edit"
      ? "view-only access"
      : editMessage;

  // One entry in the left snippets rail (reused for both "mine" and "shared").
  const renderRailItem = (item: Analysis) => {
    const active = current?.id === item.id;
    return (
      <button
        key={item.id}
        onClick={() => openFromHistory(item)}
        className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
          active
            ? "bg-elev2 text-strong"
            : "text-muted hover:bg-[var(--hover)] hover:text-fg"
        }`}
      >
        <span
          className={`flex h-5 w-7 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
            LANG_BADGE[item.language] ?? "bg-elev2 text-fg"
          }`}
        >
          {EXT[item.language] ?? "··"}
        </span>
        <span className="truncate">
          {snippetName(item.code, item.language).replace(/\.\w+$/, "")}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-[88dvh] max-h-[860px] min-h-[560px] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
      {/* ── top bar ─────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <Logo />
          <span className="font-semibold tracking-tight text-strong">CodeLens</span>
          <span className="text-faint">/</span>
          <span className="text-muted">my snippets</span>
          <span className="text-faint">/</span>
          <span className="truncate font-medium text-strong">{fileName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-[var(--hover)] hover:text-strong"
          >
            <Icon
              path={theme === "dark" ? ICONS.sun : ICONS.moon}
              className="h-4 w-4"
            />
          </button>
          {/* Stacked avatars of everyone live on this snippet (first 3 + overflow). */}
          {viewers.length > 0 && (
            <div className="flex -space-x-1.5" title="Viewing now">
              {viewers.slice(0, 3).map((v) => (
                <span
                  key={v.userId}
                  title={`${v.name} is viewing`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-emerald-600 text-[10px] font-semibold text-white"
                >
                  {v.name.charAt(0).toUpperCase()}
                </span>
              ))}
              {viewers.length > 3 && (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-elev2 text-[10px] font-semibold text-fg">
                  +{viewers.length - 3}
                </span>
              )}
            </div>
          )}
          <button
            onClick={() => setShareOpen((o) => !o)}
            disabled={!current}
            title={current ? "Collaborate on this snippet" : "Run an analysis first"}
            className="flex items-center gap-1.5 rounded-lg border border-blue-300/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_24px_-10px_rgba(79,70,229,0.85)] transition-all hover:-translate-y-0.5 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-[0_12px_30px_-12px_rgba(79,70,229,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:translate-y-0 disabled:border-line disabled:bg-none disabled:bg-elev disabled:text-muted disabled:shadow-none disabled:opacity-60"
          >
            <Icon path={ICONS.share} className="h-3.5 w-3.5" />
            Collaborate
          </button>
          <button
            onClick={handleShare}
            disabled={!structured}
            title={structured ? "Download PDF report" : "Analyze to download PDF"}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download PDF
          </button>
          <button
            onClick={logout}
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
          >
            {initialsFromToken(token)}
          </button>
        </div>
      </header>
      {/* Collaborate modal — only meaningful once a snippet exists to share. */}
      {shareOpen && current && (
        <ShareDialog
          token={token ?? ""}
          analysisId={current.id}
          isOwner={isOwner}
          viewers={viewers}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* ── body: rail · editor · analysis ──────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* snippets rail */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-line p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium tracking-wide text-muted">
              snippets
            </span>
            <button
              onClick={newSnippet}
              title="New snippet"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-[var(--hover)] hover:text-strong"
            >
              <Icon path={ICONS.plus} className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-0.5 overflow-y-auto">
            {history.length === 0 ? (
              <p className="px-2 py-3 text-xs text-faint">No snippets yet.</p>
            ) : (
              history.map(renderRailItem)
            )}

            {sharedWithMe.length > 0 && (
              <>
                <span className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-faint">
                  shared with me
                </span>
                {sharedWithMe.map(renderRailItem)}
              </>
            )}
          </div>
        </aside>

        {/* editor */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-line">
          <MonacoEditor
            height="100%"
            language={language}
            value={code}
            onChange={(v) => {
              handleCodeChange(v ?? "");
            }}
            theme={theme === "dark" ? "codelens-dark" : "codelens-light"}
            // Register the matching light/dark Monaco themes once before mount.
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("codelens-dark", {
                base: "vs-dark",
                inherit: true,
                rules: [
                  { token: "comment", foreground: "6b7685", fontStyle: "italic" },
                  { token: "keyword", foreground: "c792ea" },
                  { token: "number", foreground: "f78c6c" },
                  { token: "string", foreground: "c3e88d" },
                  { token: "type", foreground: "82aaff" },
                  { token: "identifier", foreground: "e6e6e6" },
                ],
                colors: {
                  "editor.background": "#0c0d11",
                  "editor.lineHighlightBackground": "#ffffff0a",
                  "editor.lineHighlightBorder": "#00000000",
                  "editorLineNumber.foreground": "#3f4650",
                  "editorLineNumber.activeForeground": "#9ca3af",
                  "editor.selectionBackground": "#27344e",
                  "editorIndentGuide.background1": "#1b1d23",
                },
              });
              monaco.editor.defineTheme("codelens-light", {
                base: "vs",
                inherit: true,
                rules: [
                  { token: "comment", foreground: "6b7280", fontStyle: "italic" },
                  { token: "keyword", foreground: "7c3aed" },
                  { token: "number", foreground: "b45309" },
                  { token: "string", foreground: "15803d" },
                  { token: "type", foreground: "1d4ed8" },
                  { token: "identifier", foreground: "27272a" },
                ],
                colors: {
                  "editor.background": "#ffffff",
                  "editor.lineHighlightBackground": "#0000000a",
                  "editor.lineHighlightBorder": "#00000000",
                  "editorLineNumber.foreground": "#cbd5e1",
                  "editorLineNumber.activeForeground": "#475569",
                  "editor.selectionBackground": "#bfdbfe",
                  "editorIndentGuide.background1": "#eef0f3",
                },
              });
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 22,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              padding: { top: 16, bottom: 16 },
              glyphMargin: false,
              folding: false,
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 10,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              guides: { indentation: false },
              contextmenu: false,
              smoothScrolling: true,
              // Lock the buffer when we lack edit rights or another user holds
              // the lock; the tooltip explains why.
              readOnly: isReadOnly,
              readOnlyMessage: {
                value: lockMessage
                  ? lockMessage
                  : "You only have view access for this snippet.",
              },
            }}
          />
        </div>

        {/* AI analysis */}
        <section className="flex w-[360px] shrink-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="flex items-center gap-2 text-sm font-semibold text-strong">
              <span className="text-blue-400">✦</span> AI analysis
            </span>
            <StatusPill status={current?.status} />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <AnalysisBody
              current={current}
              busy={busy}
              findings={structured?.findings ?? null}
            />
            {/* Follow-up Q&A thread; `asking` shows the optimistic "thinking" row. */}
            {(messages.length > 0 || asking) && (
              <div className="space-y-3 border-t border-line pt-3">
                {messages.map((m) => (
                  <ChatBubble key={m.id} message={m} />
                ))}
                {asking && (
                  <div className="flex items-center gap-1.5 px-1 text-xs text-muted">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
                    thinking…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* complexity + follow-up — only once we have a parsed result */}
          {structured && (
            <div className="shrink-0 space-y-3 border-t border-line p-4">
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted">
                  complexity
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <ComplexityTile label="time" value={structured.complexity.time} />
                  <ComplexityTile label="space" value={structured.complexity.space} />
                </div>
              </div>
              <form onSubmit={handleFollowUp} className="relative">
                <Icon
                  path={ICONS.chat}
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted"
                />
                <input
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  disabled={asking || !canEditSnippet}
                  placeholder={
                    canEditSnippet ? "ask follow-up" : "edit access required"
                  }
                  className="w-full rounded-lg border border-line bg-elev py-2.5 pl-9 pr-16 text-sm text-fg outline-none transition-colors placeholder:text-muted focus:border-blue-500/60 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={asking || !canEditSnippet || !followUp.trim()}
                  className="absolute right-1.5 top-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                  {asking ? "…" : "send"}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>

      {/* ── bottom bar ──────────────────────────────────────────── */}
      <footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-line px-4">
        <div className="flex min-w-0 items-center gap-4 text-xs text-muted">
          <label className="relative flex items-center">
            <span
              className={`pointer-events-none absolute left-2.5 flex h-4 w-6 items-center justify-center rounded text-[9px] font-bold ${
                LANG_BADGE[language] ?? "bg-elev2 text-fg"
              }`}
            >
              {EXT[language] ?? "··"}
            </span>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              disabled={isReadOnly}
              className="appearance-none rounded-lg border border-line bg-elev py-1.5 pl-11 pr-7 text-xs font-medium capitalize text-fg outline-none transition-colors hover:bg-[var(--hover)] disabled:opacity-60"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="bg-surface capitalize">
                  {l}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 text-muted">
              <Icon path={ICONS.chevron} className="h-3.5 w-3.5" />
            </span>
          </label>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="text-faint">⊕</span> ollama · qwen2.5-coder:7b
          </span>
          <span className="hidden md:inline">
            {lineCount} lines · {charCount} chars
          </span>
          {lockMessage && (
            <span className="hidden text-faint sm:inline">
              {lockMessage}
            </span>
          )}
          {hasUnsavedEdits && (
            <span className="hidden text-blue-400 sm:inline">
              unsaved edits
            </span>
          )}
          {error && <span className="text-red-400">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Save edits: shown only to editors; enabled only when dirty and unlocked. */}
          {current && canEditSnippet && (
            <button
              onClick={handleSaveEdits}
              disabled={!hasUnsavedEdits || isLockedByOther}
              title={
                hasUnsavedEdits
                  ? "Save changes and let others edit"
                  : "No unsaved edits"
              }
              className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-45"
            >
              Save edits
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={submitting || busy || !canEditSnippet || !code.trim()}
            title={
              canEditSnippet
                ? undefined
                : "You need edit access to analyze changes."
            }
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Icon path={ICONS.play} className="h-3.5 w-3.5" />
            {submitting
              ? "submitting…"
              : busy
                ? "analyzing…"
                : current
                  ? "reanalyze"
                  : "analyze"}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────
// Colored dot + label mirroring the analysis lifecycle: pending/processing →
// "running", completed → "live", failed, stale → "changed", else "idle".
function StatusPill({ status }: { status?: Analysis["status"] }) {
  if (status === "processing" || status === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        running
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-400">
        <span className="h-2 w-2 rounded-full bg-red-400" /> failed
      </span>
    );
  }
  if (status === "stale") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-blue-400">
        <span className="h-2 w-2 rounded-full bg-blue-400" /> changed
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> live
      </span>
    );
  }
  return <span className="text-xs text-faint">idle</span>;
}

// The analysis panel's main region. Picks one of several states to render:
// empty prompt, loading skeletons, error, stale notice, no findings, or the
// list of finding cards.
function AnalysisBody({
  current,
  busy,
  findings,
}: {
  current: Analysis | null;
  busy: boolean;
  findings: Finding[] | null;
}) {
  if (!current) {
    return (
      <p className="text-sm text-muted">
        Write some code and hit <span className="text-fg">analyze</span> to
        see findings, suggestions and complexity here.
      </p>
    );
  }
  if (busy) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Analyzing… this can take a moment.
        </p>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl border border-line bg-elev"
          />
        ))}
      </div>
    );
  }
  if (current.status === "failed") {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-sm text-red-300">
        {current.error ?? "Analysis failed."}
      </div>
    );
  }
  if (current.status === "stale") {
    return (
      <p className="text-sm text-muted">
        This snippet changed. Hit <span className="text-fg">reanalyze</span> to
        refresh findings.
      </p>
    );
  }
  if (!findings || findings.length === 0) {
    return <p className="text-sm text-muted">No findings.</p>;
  }
  return (
    <>
      {findings.map((f, i) => (
        <FindingCard key={i} finding={f} />
      ))}
    </>
  );
}

// A single finding, color-coded by type (bug / improvement / good).
function FindingCard({ finding }: { finding: Finding }) {
  const style = FINDING_STYLE[finding.type];
  return (
    <div className={`rounded-xl border p-3 ${style.box}`}>
      <div className={`mb-1.5 flex items-center gap-1.5 text-sm font-semibold ${style.head}`}>
        <Icon path={style.icon} className="h-4 w-4" />
        {style.label}
      </div>
      <p className="text-sm leading-relaxed text-fg">
        {renderMessage(finding.message)}
      </p>
    </div>
  );
}

// One follow-up message; user messages right-aligned, AI answers left with
// inline-code formatting.
function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-blue-600 text-white"
            : "border border-line bg-elev text-fg"
        }`}
      >
        {isUser ? message.content : renderMessage(message.content)}
      </div>
    </div>
  );
}

// Small labeled tile for a Big-O complexity value (time / space).
function ComplexityTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-elev px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="font-mono text-sm text-strong">{value}</p>
    </div>
  );
}
