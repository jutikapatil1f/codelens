"use client";

import { AuthForm } from "@/components/AuthForm";
import { Analyzer } from "@/components/Analyzer";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { token, ready } = useAuth();

  return (
    <main className="flex min-h-dvh w-full items-center justify-center p-4 sm:p-8">
      {!ready ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : token ? (
        <Analyzer />
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
