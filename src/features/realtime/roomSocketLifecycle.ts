import { createGameItemActions } from "../game-items/gameItemState";
import { createInitialState } from "../../app/store/clientState";
import type { StoreApi } from "zustand/vanilla";
import type {
  ConnectionStatus,
  RootClientState,
} from "../../shared/types/clientState";
import type { CurrentGameRoom, JoinRoomEvent } from "../../shared/types/domain";
import type {
  CreateRealtimeSocket,
  RealtimeSocket,
} from "../../shared/socket/socketClient";
import {
  createRawWebSocketRealtimeSocket,
  defaultSocketUrl,
} from "../../shared/socket/socketClient";
import { errorMessageMap } from "../../shared/constants/errorMessages";
import { bindRoomRealtimeEvents } from "./roomRealtimeEvents";
import {
  shouldRetainRoomSocketForPath,
} from "./realtimeEventReducers";
import {
  resolveSocketClosePolicyAction,
  shouldLatchTerminatedSocketSession,
} from "./socketClosePolicy";

export { shouldRetainRoomSocketForPath };

export type { JoinRoomEvent };

export type RoomSocketLifecycleInput = {
  accessToken: string | null;
  currentRoom: CurrentGameRoom | null;
  routeGameRoomId: string | undefined;
  socketUrl: string;
  userId: string | null;
};

export type RoomSocketEligibility =
  | {
      canConnect: true;
      joinRoomEvent: JoinRoomEvent;
      socketUrl: string;
    }
  | {
      canConnect: false;
      reason:
        | "missing-auth"
        | "missing-room"
        | "room-mismatch"
        | "not-joined"
        | "unsupported-room-status";
    };

export type RoomSocketLifecycleUpdate = {
  activeRoomId: string | null;
  connectionStatus: ConnectionStatus;
  socketId: string | null;
  closeCode: number | null;
  closeReasonCode: string | null;
};

export function parseSocketDisconnectClose(reason: unknown): {
  closeCode: number | null;
  closeReasonCode: string | null;
} {
  if (typeof reason === "number" && Number.isFinite(reason)) {
    return { closeCode: reason, closeReasonCode: null };
  }

  const text = String(reason ?? "socket closed").trim();
  if (!text) {
    return { closeCode: null, closeReasonCode: null };
  }

  const prefixedCodeMatch = text.match(/^(\d{4})\s*[:/]\s*(\S+)$/);
  if (prefixedCodeMatch) {
    return {
      closeCode: Number(prefixedCodeMatch[1]),
      closeReasonCode: prefixedCodeMatch[2],
    };
  }

  if (/^\d{4}$/.test(text)) {
    return { closeCode: Number(text), closeReasonCode: null };
  }

  return { closeCode: null, closeReasonCode: text };
}

export function isRoomSessionUnavailable(connectionStatus: ConnectionStatus) {
  return connectionStatus === "closed" || connectionStatus === "error";
}

type RoomSocketLifecycleControllerOptions = {
  createSocket: CreateRealtimeSocket;
  onSocketReleased?: () => void;
  onUpdate: (update: RoomSocketLifecycleUpdate) => void;
};

export function getRoomSocketEligibility(
  input: RoomSocketLifecycleInput,
): RoomSocketEligibility {
  if (!input.accessToken || !input.userId) {
    return {
      canConnect: false,
      reason: "missing-auth",
    };
  }

  if (!input.currentRoom) {
    return {
      canConnect: false,
      reason: "missing-room",
    };
  }

  if (input.currentRoom.gameRoomId !== input.routeGameRoomId) {
    return {
      canConnect: false,
      reason: "room-mismatch",
    };
  }

  if (input.currentRoom.myMembershipStatus !== "JOINED") {
    return {
      canConnect: false,
      reason: "not-joined",
    };
  }

  if (
    input.currentRoom.status !== "WAITING" &&
    input.currentRoom.status !== "IN_PROGRESS"
  ) {
    return {
      canConnect: false,
      reason: "unsupported-room-status",
    };
  }

  return {
    canConnect: true,
    joinRoomEvent: {
      accessToken: input.accessToken,
      gameRoomId: input.currentRoom.gameRoomId,
      userId: input.userId,
    },
    socketUrl: input.socketUrl,
  };
}

export function createRoomSocketLifecycleController({
  createSocket,
  onSocketReleased,
  onUpdate,
}: RoomSocketLifecycleControllerOptions) {
  let activeRoomId: string | null = null;
  let disconnectIsExpected = false;
  let joinRoomEvent: JoinRoomEvent | null = null;
  let socket: RealtimeSocket | null = null;
  let closeCode: number | null = null;
  let closeReasonCode: string | null = null;
  let terminatedRoomId: string | null = null;

  function update(
    connectionStatus: ConnectionStatus,
    socketId: string | null,
    nextCloseCode: number | null,
    nextCloseReasonCode: string | null,
  ) {
    onUpdate({
      activeRoomId,
      connectionStatus,
      socketId,
      closeCode: nextCloseCode,
      closeReasonCode: nextCloseReasonCode,
    });
  }

  function detachAndDisconnect(status: ConnectionStatus) {
    if (!socket) {
      activeRoomId = null;
      joinRoomEvent = null;
      update(status, null, null, null);
      return;
    }

    onSocketReleased?.();
    disconnectIsExpected = true;
    socket.disconnect();
    disconnectIsExpected = false;
    socket = null;
    activeRoomId = null;
    joinRoomEvent = null;
    closeCode = null;
    closeReasonCode = null;
    terminatedRoomId = null;
    update(status, null, null, null);
  }

  function sync(input: RoomSocketLifecycleInput) {
    const eligibility = getRoomSocketEligibility(input);

    if (!eligibility.canConnect) {
      detachAndDisconnect(
        eligibility.reason === "missing-auth" ? "left" : "idle",
      );
      return eligibility;
    }

    if (
      terminatedRoomId === eligibility.joinRoomEvent.gameRoomId &&
      shouldLatchTerminatedSocketSession(closeCode, closeReasonCode)
    ) {
      update("closed", null, closeCode, closeReasonCode);
      return eligibility;
    }

    if (socket && activeRoomId === eligibility.joinRoomEvent.gameRoomId) {
      joinRoomEvent = eligibility.joinRoomEvent;
      return eligibility;
    }

    if (socket) {
      detachAndDisconnect("idle");
    }

    activeRoomId = eligibility.joinRoomEvent.gameRoomId;
    joinRoomEvent = eligibility.joinRoomEvent;
    closeCode = null;
    closeReasonCode = null;
    terminatedRoomId = null;
    socket = createSocket({
      socketUrl: eligibility.socketUrl,
    });

    const activeSocket = socket;

    activeSocket.on("connect", () => {
      if (activeSocket !== socket || !joinRoomEvent) {
        return;
      }

      activeSocket.emit("join-room", joinRoomEvent);
      update("connected", activeSocket.id ?? null, null, null);
    });

    activeSocket.on("disconnect", (reason) => {
      if (activeSocket !== socket || disconnectIsExpected) {
        return;
      }

      onSocketReleased?.();
      socket = null;
      terminatedRoomId = activeRoomId;
      const parsedClose = parseSocketDisconnectClose(reason);
      closeCode = parsedClose.closeCode;
      closeReasonCode = parsedClose.closeReasonCode;
      update("closed", null, closeCode, closeReasonCode);
    });

    activeSocket.on("connect_error", (error) => {
      if (activeSocket !== socket) {
        return;
      }

      onSocketReleased?.();
      socket = null;
      update("error", null, null, null);
    });

    update("connecting", null, null, null);
    activeSocket.connect();

    return eligibility;
  }

  function leave(expectedRoomId?: string) {
    if (!expectedRoomId) {
      return;
    }

    if (expectedRoomId && activeRoomId !== expectedRoomId) {
      return;
    }

    detachAndDisconnect("left");
  }

  function emit(eventName: string, payload: unknown) {
    if (!socket) {
      return false;
    }

    socket.emit(eventName, payload);
    return true;
  }

  return {
    emit,
    resync: () => !!joinRoomEvent && emit("join-room", joinRoomEvent),
    leave,
    sync,
  };
}

export type RoomSocketLifecycleController = ReturnType<
  typeof createRoomSocketLifecycleController
>;

export function createStoreBackedRoomSocketLifecycleController(
  store: StoreApi<RootClientState>,
  createSocket: CreateRealtimeSocket = createRawWebSocketRealtimeSocket,
) {
  let unbindRoomRealtimeEvents: (() => void) | null = null;

  const controller = createRoomSocketLifecycleController({
    createSocket(options) {
      unbindRoomRealtimeEvents?.();
      const socket = createSocket(options);
      unbindRoomRealtimeEvents = bindRoomRealtimeEvents(socket, store);
      return socket;
    },
    onSocketReleased() {
      items.dispose();
      unbindRoomRealtimeEvents?.();
      unbindRoomRealtimeEvents = null;
    },
    onUpdate(update) {
      store.setState((state) => {
        const enteringRoom = update.activeRoomId !== null &&
          update.activeRoomId !== state.realtime.activeRoomId;
        const initial = enteringRoom ? createInitialState() : null;
        return {
          ...state,
          game: initial ? initial.game : update.connectionStatus !== "connected"
            ? { ...state.game, itemUse: { status: "needs-sync" as const, pending: null, message: "서버 상태를 다시 확인해주세요." } }
            : state.game,
          editor: initial ? initial.editor : state.editor,
          realtime: {
            ...state.realtime,
            participants: enteringRoom ? [] : state.realtime.participants,
            activeRoomId: update.activeRoomId,
            connectionStatus: update.connectionStatus,
            socketId: update.socketId,
            closeCode: update.closeCode,
            closeReasonCode: update.closeReasonCode,
          },
        };
      });
    },
  });
  const items = createGameItemActions(store, controller.emit, controller.resync);
  return { ...controller, useGameItem: items.useGameItem, syncGameItems: items.syncGameItems };
}

export function createRoomSocketLifecycleInput({
  accessToken,
  currentRoom,
  routeGameRoomId,
  userId,
}: Omit<RoomSocketLifecycleInput, "socketUrl">): RoomSocketLifecycleInput {
  return {
    accessToken,
    currentRoom,
    routeGameRoomId,
    socketUrl: defaultSocketUrl,
    userId,
  };
}

export function isSameRoomScopedPath(
  pathname: string,
  gameRoomId: string | undefined,
) {
  return !!gameRoomId && pathname.startsWith(`/rooms/${gameRoomId}/`);
}

export function formatRealtimeCloseMessage({
  closeCode,
  closeReasonCode,
}: Pick<RoomSocketLifecycleUpdate, "closeCode" | "closeReasonCode">) {
  if (closeReasonCode && errorMessageMap[closeReasonCode]) {
    return errorMessageMap[closeReasonCode];
  }

  if (closeCode !== null && closeReasonCode) {
    return `${closeCode} (${closeReasonCode})`;
  }

  if (closeCode !== null) {
    return String(closeCode);
  }

  if (closeReasonCode) {
    return closeReasonCode;
  }

  return null;
}

export function getRealtimeCloseBannerCopy({
  closeCode,
  closeReasonCode,
  connectionStatus,
}: Pick<RoomSocketLifecycleUpdate, "closeCode" | "closeReasonCode"> & {
  connectionStatus: ConnectionStatus;
}) {
  const policyAction = resolveSocketClosePolicyAction(closeCode, closeReasonCode);
  const closeMessage = formatRealtimeCloseMessage({ closeCode, closeReasonCode });

  if (connectionStatus === "error") {
    return {
      title: "실시간 연결에 실패했어요.",
      description:
        "연결 상태를 확인한 뒤 다시 입장해주세요.",
    };
  }

  if (policyAction === "intentional-close") {
    return {
      title: "실시간 연결이 종료됐어요.",
      description:
        closeMessage ?? "게임 세션이 정상적으로 종료되었습니다.",
    };
  }

  if (policyAction === "terminated-session") {
    return {
      title: "게임 세션을 계속할 수 없어요.",
      description:
        closeMessage ?? "방 접근 권한이 없거나 방을 찾을 수 없습니다.",
    };
  }

  return {
    title: "실시간 연결이 종료됐어요.",
    description: closeMessage ?? "게임 세션이 닫혔습니다.",
  };
}
