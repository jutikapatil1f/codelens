"use client";

// Centered share modal. Lets the owner invite people by email (allowlist — no
// email is sent), shows who currently has access and who is viewing live.

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type ShareAccess,
  type SnippetShare,
  type Viewer,
} from "@/lib/api";

// Two-letter avatar initials from an email or display name.
function initials(text: string): string {
  const parts = text.split(/[.\-_@\s]/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Share/collaborate modal. Owners can invite by email and change/revoke
 * per-person access; non-owners only see the live viewer list. `viewers` is
 * passed in from the parent's presence hook (not fetched here).
 */
export function ShareDialog({
  token,
  analysisId,
  isOwner,
  viewers,
  onClose,
}: {
  token: string;
  analysisId: string;
  isOwner: boolean;
  viewers: Viewer[];
  onClose: () => void;
}) {
  const [shares, setShares] = useState<SnippetShare[]>([]);
  const [email, setEmail] = useState("");
  const [access, setAccess] =
    useState<Exclude<ShareAccess, "owner">>("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh the access list. Only the owner may list shares, so skip otherwise.
  const load = useCallback(async () => {
    if (!isOwner) return;
    try {
      setShares(await api.listShares(token, analysisId));
    } catch {
      /* non-owner or transient — leave list empty */
    }
  }, [token, analysisId, isOwner]);

  useEffect(() => {
    load();
  }, [load]);

  // Add an allowlist entry for `email` at the chosen access level, then reload.
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addShare(token, analysisId, value, access);
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not invite");
    } finally {
      setBusy(false);
    }
  }

  async function updateAccess(
    shareId: string,
    nextAccess: Exclude<ShareAccess, "owner">,
  ) {
    try {
      await api.updateShare(token, analysisId, shareId, nextAccess);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update access");
    }
  }

  async function revoke(shareId: string) {
    try {
      await api.removeShare(token, analysisId, shareId);
      await load();
    } catch {
      /* ignore — list will reconcile on next load */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-[0_30px_90px_-25px_rgba(0,0,0,0.75)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
              collaborate
            </p>
            <h2 className="mt-1 text-lg font-semibold text-strong">
              Collaborate on this snippet
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Invite a peer with view access for read-only review, or edit access
              so they can work on the same snippet with you. When one person is
              editing, everyone else sees who has the editor lock.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-faint transition-colors hover:bg-[var(--hover)] hover:text-strong"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 grid gap-2 rounded-xl border border-blue-500/20 bg-blue-500/[0.08] p-3 text-xs text-muted sm:grid-cols-2">
          <div>
            <span className="font-semibold text-strong">View access</span>
            <p className="mt-1">Can open the snippet, read findings, and watch activity.</p>
          </div>
          <div>
            <span className="font-semibold text-strong">Edit access</span>
            <p className="mt-1">
              Can update the shared snippet; edits appear for both accounts.
            </p>
          </div>
        </div>

      {isOwner ? (
        <form onSubmit={invite} className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Invite by email"
            className="min-w-0 flex-1 rounded-lg border border-line bg-elev px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-blue-500"
          />
          <select
            value={access}
            onChange={(e) =>
              setAccess(e.target.value as Exclude<ShareAccess, "owner">)
            }
            className="rounded-lg border border-line bg-elev px-2 py-2 text-sm text-fg outline-none transition-colors focus:border-blue-500"
          >
            <option value="view">view</option>
            <option value="edit">edit</option>
          </select>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="col-span-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            Invite
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">
          This snippet was shared with you. Only the owner can manage access.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {isOwner && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-faint">
            People with access
          </p>
          <ul className="space-y-1.5">
            {shares.length === 0 ? (
              <li className="text-xs text-muted">No one invited yet.</li>
            ) : (
              shares.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elev2 text-[10px] font-semibold text-fg">
                    {initials(s.invitedEmail)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {s.invitedEmail}
                  </span>
                  <select
                    value={s.access}
                    onChange={(e) =>
                      updateAccess(
                        s.id,
                        e.target.value as Exclude<ShareAccess, "owner">,
                      )
                    }
                    className="rounded-md border border-line bg-elev px-1.5 py-1 text-xs text-fg"
                  >
                    <option value="view">view</option>
                    <option value="edit">edit</option>
                  </select>
                  <button
                    onClick={() => revoke(s.id)}
                    className="text-xs text-faint hover:text-red-500"
                  >
                    remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {/* Live presence pills (passed down from the parent), shown to everyone. */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium tracking-wide text-faint">
          Viewing now
        </p>
        {viewers.length === 0 ? (
          <p className="text-xs text-muted">No one else is viewing.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {viewers.map((v) => (
              <span
                key={v.userId}
                className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 py-1 pl-1 pr-2.5 text-xs text-emerald-600 dark:text-emerald-300"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] font-semibold">
                  {initials(v.name)}
                </span>
                {v.name}
              </span>
            ))}
          </div>
        )}
      </div>

      </div>
    </div>
  );
}
