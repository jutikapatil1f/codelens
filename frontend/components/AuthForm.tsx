"use client";

// Login / register form. On success it stores the returned JWT via useAuth(),
// which flips the whole app over to the authenticated view.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function AuthForm() {
  const { setToken } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password);
      setToken(accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-fg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
    >
      <div className="mb-6 flex items-center gap-2.5">
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
        <span className="text-lg font-semibold tracking-tight text-strong">CodeLens</span>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-strong">
        {mode === "login" ? "Sign in" : "Create account"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "login"
          ? "Welcome back to CodeLens."
          : "Start analyzing your code with CodeLens."}
      </p>

      <label className="mt-6 block text-sm font-medium">Email</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-elev px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500"
        placeholder="you@example.com"
      />

      <label className="mt-4 block text-sm font-medium">Password</label>
      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-elev px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500"
        placeholder="At least 8 characters"
      />

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/[0.08] px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
      >
        {loading
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
        className="mt-4 w-full text-center text-sm text-muted transition-colors hover:text-strong"
      >
        {mode === "login"
          ? "Need an account? Register"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
