"use client";

import { AuthForm } from "@/components/AuthForm";
import { Analyzer } from "@/components/Analyzer";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { token, ready, logout } = useAuth();

  // Avoid a flash of the login form before we've read the stored token.
  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <span className="text-lg font-semibold tracking-tight">CodeLens</span>
        {token && (
          <button
            onClick={logout}
            className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition-colors hover:bg-black/4 dark:border-white/15 dark:hover:bg-white/6"
          >
            Sign out
          </button>
        )}
      </header>

      {token ? <Analyzer /> : <AuthForm />}
    </div>
  );
}
