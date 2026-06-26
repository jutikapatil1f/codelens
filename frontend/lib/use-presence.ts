"use client";

// Opens one authenticated presence socket per login and joins/leaves the room
// for whichever snippet is currently open. Returns the live viewer list (who
// else is looking at this snippet) and the socket's connection state.

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Analysis, Viewer } from "./api";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export interface EditorLock {
  userId: string;
  name: string;
}

export function usePresence(
  token: string | null,
  analysisId: string | null,
  onContentUpdate?: (analysis: Analysis) => void,
) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [editor, setEditor] = useState<EditorLock | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const onContentUpdateRef = useRef(onContentUpdate);
  // Lets the (stable) presence listener read the latest snippet without
  // re-subscribing the socket every time the selection changes.
  const openIdRef = useRef<string | null>(analysisId);

  useEffect(() => {
    onContentUpdateRef.current = onContentUpdate;
  }, [onContentUpdate]);

  useEffect(() => {
    openIdRef.current = analysisId;
  }, [analysisId]);

  // One socket for the whole session, tied to the auth token.
  useEffect(() => {
    if (!token) return;
    const socket = io(WS_URL, { auth: { token } });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on(
      "presence:update",
      (p: { analysisId: string; viewers: Viewer[]; editor: EditorLock | null }) => {
        if (p.analysisId === openIdRef.current) {
          setViewers(p.viewers);
          setEditor(p.editor);
          if (p.editor) setEditMessage(`${p.editor.name} is editing`);
        }
      },
    );
    socket.on(
      "snippet:edit:denied",
      (p: { analysisId: string; reason?: string; editor?: EditorLock | null }) => {
        if (p.analysisId !== openIdRef.current) return;
        setEditor(p.editor ?? null);
        setEditMessage(p.reason ?? "Someone else is editing");
      },
    );
    socket.on(
      "snippet:edit:accepted",
      (p: { analysisId: string; editor: EditorLock | null }) => {
        if (p.analysisId !== openIdRef.current) return;
        setEditor(p.editor);
        setEditMessage(null);
      },
    );
    socket.on(
      "snippet:content:update",
      (p: { analysisId: string; analysis: Analysis; editor: EditorLock | null }) => {
        if (p.analysisId !== openIdRef.current) return;
        setEditor(p.editor);
        onContentUpdateRef.current?.(p.analysis);
      },
    );
    socket.on(
      "snippet:edit:saved",
      (p: { analysisId: string; savedBy: EditorLock | null }) => {
        if (p.analysisId !== openIdRef.current) return;
        setEditor(null);
        setEditMessage(
          p.savedBy
            ? `${p.savedBy.name} saved edits. `
            : "You can edit now.",
        );
      },
    );
    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  // Join the room for the open snippet; leave it when switching away.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !analysisId) {
      setViewers([]);
      setEditor(null);
      setEditMessage(null);
      return;
    }
    socket.emit("snippet:join", { analysisId });
    return () => {
      socket.emit("snippet:leave", { analysisId });
      setViewers([]);
      setEditor(null);
      setEditMessage(null);
    };
  }, [analysisId, connected]);

  function beginEditing() {
    if (socketRef.current && analysisId) {
      socketRef.current.emit("snippet:edit:start", { analysisId });
    }
  }

  function stopEditing() {
    if (socketRef.current && analysisId) {
      socketRef.current.emit("snippet:edit:stop", { analysisId });
    }
  }

  function publishContent(code: string, language: string) {
    if (socketRef.current && analysisId) {
      socketRef.current.emit("snippet:content:update", {
        analysisId,
        code,
        language,
      });
    }
  }

  function saveContent(code: string, language: string) {
    if (socketRef.current && analysisId) {
      socketRef.current.emit("snippet:edit:save", {
        analysisId,
        code,
        language,
      });
    }
  }

  return {
    viewers,
    editor,
    editMessage,
    connected,
    beginEditing,
    stopEditing,
    publishContent,
    saveContent,
  };
}
