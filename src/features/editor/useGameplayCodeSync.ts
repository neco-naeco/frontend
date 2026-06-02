import { useEffect, useRef } from "react";
import type { ConnectionStatus } from "../../shared/types/clientState";
import {
  buildCodeChangeScheduleEligibility,
  resolveCodeChangeFlushPayload,
  type CodeChangeEmitContext,
} from "./codeChangeFlushPolicy";
import { createCodeChangeEmitScheduler } from "./codeChangeEmitScheduler";
import { emitCodeChangeEvent } from "../realtime/emitGameplayRealtimeEvent";

const CODE_CHANGE_DEBOUNCE_MS = 200;

export type UseGameplayCodeSyncInput = {
  gameRoomId: string | undefined;
  userId: string | null;
  socketId: string | null;
  connectionStatus: ConnectionStatus;
  canEmit: boolean;
  editorFiles: Record<string, string>;
};

export function useGameplayCodeSync({
  gameRoomId,
  userId,
  socketId,
  connectionStatus,
  canEmit,
  editorFiles,
}: UseGameplayCodeSyncInput) {
  const syncedContentRef = useRef<Record<string, string>>({});
  const emitContextRef = useRef<CodeChangeEmitContext>({
    canEmit,
    connectionStatus,
    gameRoomId,
    userId,
    socketId,
  });
  const schedulerRef = useRef<ReturnType<typeof createCodeChangeEmitScheduler> | null>(
    null,
  );

  emitContextRef.current = {
    canEmit,
    connectionStatus,
    gameRoomId,
    userId,
    socketId,
  };

  useEffect(() => {
    syncedContentRef.current = { ...editorFiles };
  }, [editorFiles]);

  useEffect(() => {
    schedulerRef.current = createCodeChangeEmitScheduler({
      debounceMs: CODE_CHANGE_DEBOUNCE_MS,
      onFlush: (filePath, codeDelta, pending) => {
        const payload = resolveCodeChangeFlushPayload(
          filePath,
          codeDelta,
          pending,
          emitContextRef.current,
        );

        if (!payload) {
          return;
        }

        emitCodeChangeEvent({
          gameRoomId: payload.emitSnapshot.gameRoomId,
          userId: payload.emitSnapshot.userId,
          sessionId: payload.emitSnapshot.sessionId,
          filePath: payload.filePath,
          content: pending.currentText,
        });
      },
    });

    return () => {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
    };
  }, []);

  const trackLocalEditorChange = (
    filePath: string,
    previousText: string,
    nextText: string,
  ) => {
    syncedContentRef.current[filePath] = nextText;

    if (previousText === nextText) {
      return;
    }

    schedulerRef.current?.schedule(
      filePath,
      previousText,
      nextText,
      buildCodeChangeScheduleEligibility(emitContextRef.current),
    );
  };

  const flushPendingCodeChanges = () => {
    schedulerRef.current?.flushPending();
  };

  return {
    trackLocalEditorChange,
    flushPendingCodeChanges,
  };
}
