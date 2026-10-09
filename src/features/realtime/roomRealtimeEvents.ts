import type { StoreApi } from "zustand/vanilla";
import type { RootClientState } from "../../shared/types/clientState";
import type {
  CodeUpdatedEvent,
  GameStartedEvent,
  GameStateUpdatedEvent,
  MissionResultEvent,
  RoomParticipantsUpdatedEvent,
  TurnChangedEvent,
  TurnEvaluatedEvent,
  TeamChatMessage,
} from "../../shared/types/domain";
import type { RealtimeSocket } from "../../shared/socket/socketClient";
import {
  clearMissionResultSession,
  saveMissionResultSession,
} from "../game-result/missionResultModel";
import { navigateToGameplay, navigateToResult } from "./realtimeNavigation";
import {
  applyCodeUpdated,
  applyGameStarted,
  applyGameStateUpdated,
  applyMissionResult,
  applyRoomParticipantsUpdatedWithNavigation,
  applyTurnChanged,
  applyTurnEvaluated,
  parseRealtimeEventPayload,
} from "./realtimeEventReducers";

const ROOM_PARTICIPANTS_UPDATED = "room-participants-updated";
const GAME_STARTED = "game-started";
const GAME_STATE_UPDATED = "game-state-updated";
const CODE_UPDATED = "code-updated";
const TURN_EVALUATED = "turn-evaluated";
const TURN_CHANGED = "turn-changed";
const MISSION_RESULT = "mission-result";
const TEAM_CHAT_MESSAGE = "team-chat-message";

export function bindRoomRealtimeEvents(
  socket: RealtimeSocket,
  store: StoreApi<RootClientState>,
) {
  function handleRoomParticipantsUpdated(payload: unknown) {
    const event = parseRealtimeEventPayload<RoomParticipantsUpdatedEvent>(payload);
    if (!event?.gameRoomId) {
      return;
    }

    const { state: nextState, navigationTarget } =
      applyRoomParticipantsUpdatedWithNavigation(store.getState(), event);
    store.setState(nextState);

    if (navigationTarget) {
      navigateToGameplay(navigationTarget);
    }
  }

  function handleGameStarted(payload: unknown) {
    const event = parseRealtimeEventPayload<GameStartedEvent>(payload);
    if (!event?.gameRoomId) {
      return;
    }

    clearMissionResultSession(event.gameRoomId);

    const { state: nextState, navigationTarget } = applyGameStarted(
      store.getState(),
      event,
    );
    store.setState(nextState);

    if (navigationTarget) {
      navigateToGameplay(navigationTarget);
    }
  }

  function handleGameStateUpdated(payload: unknown) {
    const event = parseRealtimeEventPayload<GameStateUpdatedEvent>(payload);
    if (!event?.gameRoomId) {
      return;
    }

    store.setState((state) => applyGameStateUpdated(state, event));
  }

  function handleCodeUpdated(payload: unknown) {
    const event = parseRealtimeEventPayload<CodeUpdatedEvent>(payload);
    if (!event?.gameRoomId || !event.filePath) {
      return;
    }

    store.setState((state) => applyCodeUpdated(state, event));
  }

  function handleTurnEvaluated(payload: unknown) {
    const event = parseRealtimeEventPayload<TurnEvaluatedEvent>(payload);
    if (!event?.gameRoomId) {
      return;
    }

    store.setState((state) => applyTurnEvaluated(state, event));
  }

  function handleTurnChanged(payload: unknown) {
    const event = parseRealtimeEventPayload<TurnChangedEvent>(payload);
    if (!event?.gameRoomId || (!event.turnState?.turnId && !event.currentTurnId)) {
      return;
    }

    store.setState((state) => applyTurnChanged(state, event));
  }

  function handleMissionResult(payload: unknown) {
    const event = parseRealtimeEventPayload<MissionResultEvent>(payload);
    if (!event?.gameRoomId || !event.missionResult) {
      return;
    }

    saveMissionResultSession(event.gameRoomId, event.missionResult);

    const { state: nextState, navigationTarget } = applyMissionResult(
      store.getState(),
      event,
    );
    store.setState(nextState);

    if (navigationTarget) {
      navigateToResult(navigationTarget);
    }
  }

  function handleTeamChatMessage(payload: unknown) {
    const message = payload as Partial<TeamChatMessage> | null;
    if (
      !message ||
      typeof message.messageId !== "string" ||
      typeof message.gameRoomId !== "string" ||
      typeof message.senderUserId !== "string" ||
      typeof message.senderNickname !== "string" ||
      typeof message.content !== "string" ||
      typeof message.createdAt !== "string"
    ) {
      return;
    }

    store.setState((state) => {
      if (state.realtime.activeRoomId !== message.gameRoomId) return state;
      if (state.teamChat.messages.some((item) => item.messageId === message.messageId)) return state;
      return {
        ...state,
        teamChat: {
          ...state.teamChat,
          messages: [...state.teamChat.messages, message as TeamChatMessage],
        },
      };
    });
  }

  socket.on(ROOM_PARTICIPANTS_UPDATED, handleRoomParticipantsUpdated);
  socket.on(GAME_STARTED, handleGameStarted);
  socket.on(GAME_STATE_UPDATED, handleGameStateUpdated);
  socket.on(CODE_UPDATED, handleCodeUpdated);
  socket.on(TURN_EVALUATED, handleTurnEvaluated);
  socket.on(TURN_CHANGED, handleTurnChanged);
  socket.on(MISSION_RESULT, handleMissionResult);
  socket.on(TEAM_CHAT_MESSAGE, handleTeamChatMessage);

  return () => {
    socket.off(ROOM_PARTICIPANTS_UPDATED, handleRoomParticipantsUpdated);
    socket.off(GAME_STARTED, handleGameStarted);
    socket.off(GAME_STATE_UPDATED, handleGameStateUpdated);
    socket.off(CODE_UPDATED, handleCodeUpdated);
    socket.off(TURN_EVALUATED, handleTurnEvaluated);
    socket.off(TURN_CHANGED, handleTurnChanged);
    socket.off(MISSION_RESULT, handleMissionResult);
    socket.off(TEAM_CHAT_MESSAGE, handleTeamChatMessage);
  };
}
