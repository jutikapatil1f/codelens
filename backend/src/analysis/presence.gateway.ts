// Socket.IO gateway powering live presence + a single-writer editor lock for
// shared snippets. Frontend counterpart: frontend/lib/use-presence.ts (same
// event names). All state is in-memory, so it resets on server restart.

import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/auth.service';
import { AnalysisService } from './analysis.service';

interface Viewer {
  socketId: string;
  userId: string;
  name: string;
}

type Editor = Viewer;

// Identity we attach to each authenticated socket.
interface SocketUser {
  userId: string;
  email: string;
  name: string;
}

interface SocketData {
  user?: SocketUser;
}

/**
 * Realtime presence for shared snippets.
 *
 * Clients open one authenticated socket, then emit `snippet:join` with an
 * analysis id when they open a snippet. The gateway verifies they may view it
 * (owner or invited — reusing AnalysisService.canView), puts them in a room
 * `snippet:<id>`, and broadcasts the live viewer list to everyone in that room.
 * Leaving the snippet or disconnecting updates the list.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PresenceGateway.name);
  @WebSocketServer() private server: Server;

  // analysisId -> (socketId -> viewer). The source of truth for who's viewing.
  private readonly rooms = new Map<string, Map<string, Viewer>>();
  // analysisId -> editor lock. Only this socket may publish edits.
  private readonly editors = new Map<string, Editor>();

  constructor(
    private readonly jwt: JwtService,
    private readonly analysis: AnalysisService,
  ) {}

  // Authenticate on connect using the JWT passed in the handshake. A bad or
  // missing token gets the socket dropped immediately.
  handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace('Bearer ', '') ??
      '';
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: SocketUser = {
        userId: payload.sub,
        email: payload.email,
        name: displayName(payload.email),
      };
      this.setSocketUser(socket, user);
    } catch {
      socket.disconnect(true);
    }
  }

  // Drop the socket from every room it was viewing and refresh those lists.
  handleDisconnect(socket: Socket) {
    for (const [analysisId, viewers] of this.rooms) {
      if (viewers.delete(socket.id)) {
        this.releaseEditorIfHeld(socket, analysisId);
        if (viewers.size === 0) this.rooms.delete(analysisId);
        this.broadcast(analysisId);
      }
    }
  }

  // Client opened a snippet: gate on view access, place the socket in the
  // snippet's room, register it as a viewer, and broadcast the new list.
  @SubscribeMessage('snippet:join')
  async onJoin(socket: Socket, payload: { analysisId?: string }) {
    const user = this.getSocketUser(socket);
    const analysisId = payload?.analysisId;
    if (!user || !analysisId) return;

    // Only people allowed to view the snippet may join its presence room.
    const allowed = await this.analysis.canView(
      user.userId,
      user.email,
      analysisId,
    );
    if (!allowed) return;

    const room = `snippet:${analysisId}`;
    await socket.join(room);
    const viewers = this.rooms.get(analysisId) ?? new Map<string, Viewer>();
    viewers.set(socket.id, {
      socketId: socket.id,
      userId: user.userId,
      name: user.name,
    });
    this.rooms.set(analysisId, viewers);
    this.broadcast(analysisId);
  }

  // Client closed/switched the snippet: leave the room, drop the viewer,
  // free the lock if this socket held it, and refresh the list.
  @SubscribeMessage('snippet:leave')
  async onLeave(socket: Socket, payload: { analysisId?: string }) {
    const analysisId = payload?.analysisId;
    if (!analysisId) return;
    await socket.leave(`snippet:${analysisId}`);
    const viewers = this.rooms.get(analysisId);
    if (viewers?.delete(socket.id)) {
      this.releaseEditorIfHeld(socket, analysisId);
      if (viewers.size === 0) this.rooms.delete(analysisId);
      this.broadcast(analysisId);
    }
  }

  // Request the editor lock. Acquires it only if the user has edit access and
  // no one else currently holds it; the holder is the single writer until they
  // stop/save/disconnect. Denials carry the reason so the client can show it.
  @SubscribeMessage('snippet:edit:start')
  async onEditStart(socket: Socket, payload: { analysisId?: string }) {
    const user = this.getSocketUser(socket);
    const analysisId = payload?.analysisId;
    if (!user || !analysisId) return;

    // View-only invitees can't grab the lock.
    const allowed = await this.analysis.canEdit(
      user.userId,
      user.email,
      analysisId,
    );
    if (!allowed) {
      socket.emit('snippet:edit:denied', {
        analysisId,
        reason: 'You only have view access',
      });
      return;
    }

    // Lock already taken by a different socket → deny (re-asking from the same
    // socket is a no-op refresh and falls through to re-set the lock).
    const current = this.editors.get(analysisId);
    if (current && current.socketId !== socket.id) {
      socket.emit('snippet:edit:denied', {
        analysisId,
        editor: this.publicEditor(current),
        reason: `${current.name} is editing`,
      });
      return;
    }

    this.editors.set(analysisId, {
      socketId: socket.id,
      userId: user.userId,
      name: user.name,
    });
    socket.emit('snippet:edit:accepted', {
      analysisId,
      editor: this.publicEditor(this.editors.get(analysisId)),
    });
    this.broadcast(analysisId);
  }

  // Voluntarily release the lock without saving; broadcast so others see it free.
  @SubscribeMessage('snippet:edit:stop')
  onEditStop(socket: Socket, payload: { analysisId?: string }) {
    const analysisId = payload?.analysisId;
    if (!analysisId) return;
    this.releaseEditorIfHeld(socket, analysisId);
    this.broadcast(analysisId);
  }

  // Live keystroke sync from the lock holder: persist the in-progress code and
  // fan it out to every viewer so they see edits as they happen. Lock stays held.
  @SubscribeMessage('snippet:content:update')
  async onContentUpdate(
    socket: Socket,
    payload: { analysisId?: string; code?: string; language?: string },
  ) {
    const user = this.getSocketUser(socket);
    const analysisId = payload?.analysisId;
    if (!user || !analysisId) return;

    // Only the current lock holder may push content; others get denied.
    const editor = this.editors.get(analysisId);
    if (editor?.socketId !== socket.id) {
      socket.emit('snippet:edit:denied', {
        analysisId,
        editor: this.publicEditor(editor),
        reason: editor ? `${editor.name} is editing` : 'Start editing first',
      });
      return;
    }

    const analysis = await this.analysis.updateContent(
      user.userId,
      user.email,
      analysisId,
      {
        code: payload.code,
        language: payload.language,
      },
    );
    this.server.to(`snippet:${analysisId}`).emit('snippet:content:update', {
      analysisId,
      analysis,
      editor: this.publicEditor(editor),
    });
    this.broadcast(analysisId);
  }

  // Final save by the lock holder: persist, release the lock, then broadcast
  // the saved content (editor: null) plus a separate `edit:saved` notice so the
  // others know the snippet is free to edit again.
  @SubscribeMessage('snippet:edit:save')
  async onEditSave(
    socket: Socket,
    payload: { analysisId?: string; code?: string; language?: string },
  ) {
    const user = this.getSocketUser(socket);
    const analysisId = payload?.analysisId;
    if (!user || !analysisId) return;

    // Only the current lock holder may save; others get denied.
    const editor = this.editors.get(analysisId);
    if (editor?.socketId !== socket.id) {
      socket.emit('snippet:edit:denied', {
        analysisId,
        editor: this.publicEditor(editor),
        reason: editor ? `${editor.name} is editing` : 'Start editing first',
      });
      return;
    }

    const analysis = await this.analysis.updateContent(
      user.userId,
      user.email,
      analysisId,
      {
        code: payload.code,
        language: payload.language,
      },
    );
    const savedBy = this.publicEditor(editor);
    this.releaseEditorIfHeld(socket, analysisId);
    this.server.to(`snippet:${analysisId}`).emit('snippet:content:update', {
      analysisId,
      analysis,
      editor: null,
    });
    this.server.to(`snippet:${analysisId}`).emit('snippet:edit:saved', {
      analysisId,
      savedBy,
    });
    this.broadcast(analysisId);
  }

  // Emit the current viewer list (deduped by user, so two tabs count once) to
  // everyone in the snippet's room.
  private broadcast(analysisId: string) {
    const viewers = this.rooms.get(analysisId);
    const byUser = new Map<string, { userId: string; name: string }>();
    for (const v of viewers?.values() ?? []) {
      if (!byUser.has(v.userId)) {
        byUser.set(v.userId, { userId: v.userId, name: v.name });
      }
    }
    this.server.to(`snippet:${analysisId}`).emit('presence:update', {
      analysisId,
      viewers: [...byUser.values()],
      editor: this.publicEditor(this.editors.get(analysisId)),
    });
  }

  // Free the lock only if this exact socket owns it, so leaving/disconnecting
  // never steals the lock out from under whoever currently holds it.
  private releaseEditorIfHeld(socket: Socket, analysisId: string) {
    if (this.editors.get(analysisId)?.socketId === socket.id) {
      this.editors.delete(analysisId);
    }
  }

  private getSocketUser(socket: Socket): SocketUser | undefined {
    return (socket.data as SocketData).user;
  }

  private setSocketUser(socket: Socket, user: SocketUser) {
    (socket.data as SocketData).user = user;
  }

  // Strip the internal socketId before sending the lock holder to clients.
  private publicEditor(editor: Editor | undefined) {
    return editor
      ? {
          userId: editor.userId,
          name: editor.name,
        }
      : null;
  }
}

// "jutika.patil@x.com" -> "Jutika"
function displayName(email: string): string {
  const first = (email?.split('@')[0] ?? '').split(/[.\-_]/)[0] ?? '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Someone';
}
