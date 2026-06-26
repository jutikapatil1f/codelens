# Snippet Sharing & Live Presence

How invite-only snippet sharing and real-time "who's viewing" presence are
built in CodeLens. Two layers that stack:

- **Sharing (HTTP):** an *allowlist* — invite people by email; they get read
  access. **No email is sent** (no provider/domain needed); an invited user
  sees the snippet once they log in with that email.
- **Presence (WebSocket):** live viewer avatars for whoever has a shared
  snippet open right now.

---

## 1. Data model

A single new table, `snippet_shares`
([backend/src/analysis/snippet-share.entity.ts](../backend/src/analysis/snippet-share.entity.ts)):

| column | meaning |
|--------|---------|
| `id` | uuid |
| `analysisId` | the snippet being shared (indexed) |
| `invitedEmail` | the invitee's email, **stored lowercased** (indexed) |
| `invitedBy` | the owner who created the invite |
| `createdAt` | timestamp |

`@Unique(['analysisId', 'invitedEmail'])` keeps one invite per (snippet, email).
The table is auto-created on boot (`synchronize: true`) — no migration.

There is **no `sharedUserId`**: access is matched purely on the email string.
That's what makes it work without sending anything — the invite exists the
moment the owner types the address, and it "activates" for whoever logs in with
a matching account email.

---

## 2. Access control (the core change)

Previously every read was owner-scoped: `findOneForUser(userId, id)` looked up
`where { id, userId }`. Sharing adds a second path, in
[analysis.service.ts](../backend/src/analysis/analysis.service.ts):

```
findViewable(userId, email, id):
  load analysis by id
  if analysis.userId === userId      → allowed (owner)
  else if a share row matches (id, email.toLowerCase()) → allowed (invited)
  else → throw NotFound   // 404, not 403 — don't leak which ids exist
```

Who uses which check:

| Action | Endpoint | Check |
|--------|----------|-------|
| View an analysis | `GET /analyses/:id` | `findViewable` (owner **or** invited) |
| Read the chat thread | `GET /analyses/:id/messages` | `findViewable` |
| Ask a follow-up | `POST /analyses/:id/messages` | `findOneForUser` (**owner only**) |
| Invite / list / revoke | `…/shares` | `findOneForUser` (**owner only**) |
| Snippets shared with me | `GET /analyses/shared` | by my JWT email |

> Note: follow-up questions stay owner-only, so sharing is effectively
> **read-only** today. Loosening that is a one-line swap (`findViewable`) if you
> want collaborators to chat too.

### Endpoints added ([analysis.controller.ts](../backend/src/analysis/analysis.controller.ts))

```
GET    /analyses/shared              → snippets shared with me
GET    /analyses/:id/shares          → invite list (owner)
POST   /analyses/:id/shares {email}  → invite (owner, idempotent)
DELETE /analyses/:id/shares/:shareId → revoke (owner)
```

`GET /analyses/shared` is declared **before** `GET /analyses/:id` on purpose —
otherwise the `:id` param route would capture the literal path `shared`.

---

## 3. Presence over WebSocket

Presence answers "who is looking at this snippet *right now*", which is live and
ephemeral — a perfect fit for a socket, a poor fit for HTTP polling.

### The gateway ([presence.gateway.ts](../backend/src/analysis/presence.gateway.ts))

Built on `@nestjs/websockets` + Socket.IO. Lifecycle:

1. **Connect & authenticate.** The client opens one socket with its JWT in the
   handshake (`auth.token`). `handleConnection` verifies it with the same
   `JwtService`/secret as HTTP auth and stashes `{ userId, email, name }` on the
   socket. A bad/missing token → the socket is dropped immediately.

2. **Join a snippet room.** When the client opens a snippet it emits
   `snippet:join { analysisId }`. The gateway calls
   `AnalysisService.canView(...)` (the boolean form of `findViewable`) — **only
   people allowed to view may join** — then `socket.join("snippet:<id>")`.

3. **Track & broadcast.** An in-memory map `analysisId → (socketId → viewer)` is
   the source of truth. On every join/leave/disconnect the gateway emits
   `presence:update { analysisId, viewers }` to that room. Viewers are **deduped
   by user**, so the same person in two tabs counts once.

4. **Leave / disconnect.** `snippet:leave` or a dropped socket removes the
   viewer and re-broadcasts the updated list.

```
Browser A ──join snippet X──▶ gateway ──checks canView──▶ room "snippet:X"
Browser B ──join snippet X──▶ gateway ──────────────────▶ room "snippet:X"
                                  │ broadcasts presence:update {viewers:[A,B]}
Browser A ◀───────────────────── │ ─────────────────────▶ Browser B
```

`JwtModule` is registered in `AnalysisModule` so the gateway can verify tokens
without importing the whole auth module.

### Client ([lib/use-presence.ts](../frontend/lib/use-presence.ts))

A `usePresence(token, analysisId)` hook:

- Opens **one** socket per login (effect keyed on `token`), tracks `connected`.
- Joins the room for the open snippet and leaves on switch (effect keyed on
  `analysisId`). The presence listener reads the open id from a **ref** so the
  socket isn't torn down on every selection change.
- Returns `{ viewers, connected }`.

---

## 4. Frontend UX

- **Share popover** ([components/ShareDialog.tsx](../frontend/components/ShareDialog.tsx)):
  the header **share** button opens it. Owners get an "invite by email" field,
  the list of people with access (with remove), a "viewing now" list, and the
  **Download PDF report** action. Non-owners see a read-only note + PDF.
- **Presence avatars** ([components/Analyzer.tsx](../frontend/components/Analyzer.tsx)):
  a small stacked-avatar cluster appears in the header when others are viewing.
- **"Shared with me"**: a second group in the snippets rail, populated by
  `GET /analyses/shared`.
- **Owner detection**: `current.userId === sub` (the id decoded from the JWT)
  decides whether the popover shows invite management.

---

## 5. What's intentionally NOT here

- **No emails sent.** Pure allowlist. To add real invite emails later, drop in a
  provider (Resend/SMTP) at the `addShare` step — the access logic doesn't change.
- **Single-process assumption for presence.** The viewer map lives in memory, so
  it's correct for one backend instance (current setup). If you scale to multiple
  instances, add the **Socket.IO Redis adapter** (`@socket.io/redis-adapter`)
  over the Redis you already run, so rooms span instances.
- **Read-only sharing.** Invited users can view + read the chat, but not ask
  follow-ups or re-share (owner-only).
- **Status-push still polls.** This work added presence; the analysis
  `pending→completed` updates are still delivered by the existing poll loop. The
  same gateway can later carry those too.
