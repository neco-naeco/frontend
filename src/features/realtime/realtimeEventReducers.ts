import {
  applyAuthoritativeFilesToEditor,
  extractAuthoritativeFilesFromCodeUpdated,
  extractAuthoritativeFilesFromMissionState,
  isSameClientCodeUpdatedEcho,
} from "../editor/authoritativeEditorSync";
import { applyCodeDeltaToEditor } from "../editor/editorCodeDeltaSync";
import { hasApplicableCodeDelta } from "../editor/codeDelta";
import { onEditorTurnIdChanged } from "../editor/editorTurnBaseline";
import type { RootClientState } from "../../shared/types/clientState";
import type {
  CodeUpdatedEvent,
  CurrentGameRoom,
  GameStartedEvent,
  GameState,
  GameStateUpdatedEvent,
  MissionResultEvent,
  RoomParticipantsUpdatedEvent,
  RoomWaitingParticipant,
  RoomWaitingState,
  TurnChangedEvent,
  TurnEvaluatedEvent,
} from "../../shared/types/domain";

export type GameplayNavigationTarget = `/rooms/${string}/play`;
export type ResultNavigationTarget = `/rooms/${string}/result`;

export type ApplyGameStartedResult = {
  state: RootClientState;
  navigationTarget: GameplayNavigationTarget | null;
};

export type ApplyMissionResultResult = {
  state: RootClientState;
  navigationTarget: ResultNavigationTarget | null;
};

export function shouldRetainRoomSocketForPath(
  pathname: string,
  gameRoomId: string | undefined,
) {
  if (!gameRoomId) {
    return false;
  }

  if (pathname.startsWith(`/rooms/${gameRoomId}/`)) {
    return true;
  }

  return pathname === "/main";
}

export function isActiveRoomRealtimeEvent(
  state: RootClientState,
  gameRoomId: string,
) {
  return state.realtime.activeRoomId === gameRoomId;
}

export function mergeCurrentRoomFromGameState(
  currentRoom: CurrentGameRoom,
  gameState: GameState,
  participants: RoomWaitingParticipant[],
): CurrentGameRoom {
  const joinedParticipantCount = participants.filter(
    (participant) => participant.membershipStatus === "JOINED",
  ).length;

  return {
    ...currentRoom,
    status: gameState.status,
    difficulty: gameState.difficulty ?? currentRoom.difficulty,
    timeLimitSeconds: gameState.timeLimitSeconds ?? currentRoom.timeLimitSeconds,
    maxStrikeCount: gameState.maxStrikeCount ?? currentRoom.maxStrikeCount,
    minParticipants: gameState.minParticipants ?? currentRoom.minParticipants,
    maxParticipants: gameState.maxParticipants ?? currentRoom.maxParticipants,
    joinedParticipantCount:
      joinedParticipantCount > 0
        ? joinedParticipantCount
        : currentRoom.joinedParticipantCount,
  };
}

export function buildRoomWaitingStateFromParticipantsEvent(
  currentRoom: CurrentGameRoom,
  event: RoomParticipantsUpdatedEvent,
): RoomWaitingState {
  return {
    currentRoom: mergeCurrentRoomFromGameState(
      currentRoom,
      event.gameState,
      event.participants,
    ),
    participants: event.participants,
    changedParticipant: event.changedParticipant,
    gameState: event.gameState,
    missionState: event.missionState,
  };
}

function resolveGameplayParticipants(
  state: RootClientState,
  gameRoomId: string,
): RoomWaitingParticipant[] {
  const realtimeParticipants = state.realtime.participants;
  const waitingRoomParticipants =
    state.room.roomWaitingState?.currentRoom.gameRoomId === gameRoomId
      ? state.room.roomWaitingState.participants
      : [];

  if (waitingRoomParticipants.length <= realtimeParticipants.length) {
    return realtimeParticipants;
  }

  return waitingRoomParticipants;
}

function mergeGameState(
  previous: GameState | null,
  incoming: GameState,
): GameState {
  return {
    ...previous,
    ...incoming,
    turnState: incoming.turnState ?? previous?.turnState,
  };
}

function mergeMissionState(
  state: RootClientState,
  missionState: GameStateUpdatedEvent["missionState"],
) {
  if (missionState === undefined) {
    return state.game.missionState;
  }

  if (missionState === null) {
    return null;
  }

  return {
    ...state.game.missionState,
    ...missionState,
  };
}

export function bootstrapEditorFromMission(
  missionState: GameStartedEvent["missionState"],
): RootClientState["editor"] {
  const projectFiles = missionState.projectStructure?.files ?? [];
  const authoritativeFiles = Object.fromEntries(
    projectFiles
      .filter(
        (file): file is typeof file & { content: string } =>
          Object.prototype.hasOwnProperty.call(file, "content") &&
          typeof file.content === "string",
      )
      .map((file) => [file.filePath, file.content]),
  );
  const files = Object.fromEntries(
    projectFiles.map((file) => [
      file.filePath,
      authoritativeFiles[file.filePath] ?? "",
    ]),
  );

  return {
    files,
    authoritativeFiles,
    activeFilePath:
      missionState.projectStructure?.entryFilePath ??
      projectFiles[0]?.filePath ??
      null,
    markers: [],
    turnBaselineFiles: {},
    turnBaselineTurnId: null,
    turnBaselineReady: false,
  };
}

export function applyRoomParticipantsUpdated(
  state: RootClientState,
  event: RoomParticipantsUpdatedEvent,
): RootClientState {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return state;
  }

  const nextGame = {
    ...state.game,
    gameState: event.gameState,
    missionState: event.missionState,
  };
  const nextRealtime = {
    ...state.realtime,
    participants: event.participants,
  };

  if (state.room.currentRoom?.gameRoomId !== event.gameRoomId) {
    return {
      ...state,
      game: nextGame,
      realtime: nextRealtime,
    };
  }

  const currentRoom = mergeCurrentRoomFromGameState(
    state.room.currentRoom,
    event.gameState,
    event.participants,
  );

  return {
    ...state,
    game: nextGame,
    realtime: nextRealtime,
    room: {
      ...state.room,
      currentRoom,
      roomWaitingState: buildRoomWaitingStateFromParticipantsEvent(
        currentRoom,
        event,
      ),
    },
  };
}

export function applyGameStarted(
  state: RootClientState,
  event: GameStartedEvent,
): ApplyGameStartedResult {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return { state, navigationTarget: null };
  }

  const gameplayParticipants = resolveGameplayParticipants(state, event.gameRoomId);
  const bootstrappedEditor = bootstrapEditorFromMission(event.missionState);

  let nextState: RootClientState = {
    ...state,
    game: {
      gameState: event.gameState,
      missionState: event.missionState,
      showMissionGuideModal: event.uiHints.showMissionGuideModal,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: onEditorTurnIdChanged(
      bootstrappedEditor,
      event.gameState.turnState?.turnId,
    ),
    realtime: {
      ...state.realtime,
      participants: gameplayParticipants,
    },
  };

  if (state.room.currentRoom?.gameRoomId === event.gameRoomId) {
    const currentRoom = mergeCurrentRoomFromGameState(
      state.room.currentRoom,
      event.gameState,
      gameplayParticipants,
    );

    nextState = {
      ...nextState,
      room: {
        ...state.room,
        currentRoom,
        roomWaitingState: state.room.roomWaitingState
          ? {
              ...state.room.roomWaitingState,
              currentRoom,
              gameState: event.gameState,
              missionState: event.missionState,
            }
          : state.room.roomWaitingState,
      },
    };
  }

  return {
    state: nextState,
    navigationTarget: event.uiHints.enterGameScreen
      ? (`/rooms/${event.gameRoomId}/play` as const)
      : null,
  };
}

export function applyGameStateUpdated(
  state: RootClientState,
  event: GameStateUpdatedEvent,
): RootClientState {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return state;
  }

  const gameplayParticipants = resolveGameplayParticipants(state, event.gameRoomId);
  const mergedGameState = mergeGameState(state.game.gameState, event.gameState);
  const mergedMissionState = mergeMissionState(state, event.missionState);
  const previousTurnId = state.game.gameState?.turnState?.turnId;
  const nextTurnId = mergedGameState.turnState?.turnId;
  const isTurnChanging = Boolean(
    nextTurnId && nextTurnId !== previousTurnId,
  );
  const editorWithSnapshot = isTurnChanging
    ? applyAuthoritativeFilesToEditor(
        state.editor,
        extractAuthoritativeFilesFromMissionState(event.missionState),
        previousTurnId,
      )
    : state.editor;

  let nextState: RootClientState = {
    ...state,
    game: {
      ...state.game,
      gameState: mergedGameState,
      missionState: mergedMissionState,
    },
    editor:
      isTurnChanging
        ? onEditorTurnIdChanged(editorWithSnapshot, nextTurnId)
        : editorWithSnapshot,
  };

  if (state.room.currentRoom?.gameRoomId !== event.gameRoomId) {
    return nextState;
  }

  const currentRoom = mergeCurrentRoomFromGameState(
    state.room.currentRoom,
    mergedGameState,
    gameplayParticipants,
  );

  return {
    ...nextState,
    room: {
      ...state.room,
      currentRoom,
      roomWaitingState: state.room.roomWaitingState
        ? {
            ...state.room.roomWaitingState,
            currentRoom,
            gameState: mergedGameState,
            missionState: mergedMissionState,
          }
        : state.room.roomWaitingState,
    },
  };
}

export function applyCodeUpdated(
  state: RootClientState,
  event: CodeUpdatedEvent,
): RootClientState {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return state;
  }

  if (isSameClientCodeUpdatedEcho(state.realtime.socketId, event.sessionId)) {
    return state;
  }

  const activeTurnId = state.game.gameState?.turnState?.turnId ?? null;
  let nextEditor = state.editor;

  const incoming = extractAuthoritativeFilesFromCodeUpdated(event);
  if (incoming) {
    nextEditor = applyAuthoritativeFilesToEditor(
      nextEditor,
      incoming,
      activeTurnId,
    );
  }

  const codeDelta = event.codeDelta;
  if (codeDelta && hasApplicableCodeDelta(codeDelta)) {
    nextEditor = applyCodeDeltaToEditor(
      nextEditor,
      event.filePath,
      codeDelta,
    );
  }

  if (nextEditor === state.editor) {
    return state;
  }

  return {
    ...state,
    editor: nextEditor,
  };
}

function mergeStrikeCountsFromEvaluation(
  gameState: GameState,
  strikeCount: number,
  remainingStrikeCount: number,
): GameState {
  const maxStrikeCount =
    gameState.maxStrikeCount ?? strikeCount + remainingStrikeCount;

  return {
    ...gameState,
    strikeCount,
    maxStrikeCount: Math.max(maxStrikeCount, strikeCount),
  };
}

function mergeTurnStateFromEvaluation(
  gameState: GameState | null,
  event: TurnEvaluatedEvent,
): GameState | null {
  if (!gameState?.turnState) {
    return gameState;
  }

  if (gameState.turnState.turnId !== event.evaluatedTurn.turnId) {
    return gameState;
  }

  return {
    ...gameState,
    turnState: {
      ...gameState.turnState,
      status: event.evaluatedTurn.status,
    },
  };
}

function buildTurnChangedTurnState(
  state: RootClientState,
  event: TurnChangedEvent,
) {
  if (event.turnState?.turnId) {
    return event.turnState;
  }

  if (!event.currentTurnId || !event.currentTurnUserId || !event.occurredAt) {
    return null;
  }

  const previousTurnState = state.game.gameState?.turnState;
  const timeLimitSeconds =
    previousTurnState?.timeLimitSeconds ??
    state.game.gameState?.timeLimitSeconds ??
    state.room.currentRoom?.timeLimitSeconds ??
    0;
  const startedAt = event.occurredAt;
  const startedAtMs = Date.parse(startedAt);
  const deadlineAt =
    Number.isNaN(startedAtMs) || timeLimitSeconds <= 0
      ? startedAt
      : new Date(startedAtMs + timeLimitSeconds * 1000).toISOString();
  const turnNumber =
    previousTurnState && previousTurnState.turnId !== event.currentTurnId
      ? previousTurnState.turnNumber + 1
      : previousTurnState?.turnNumber ?? 1;

  return {
    turnId: event.currentTurnId,
    turnNumber,
    currentPlayerId: event.currentTurnUserId,
    startedAt,
    deadlineAt,
    timeLimitSeconds,
    remainingTimeSeconds: timeLimitSeconds,
    status: "IN_PROGRESS" as const,
  };
}

export function applyTurnEvaluated(
  state: RootClientState,
  event: TurnEvaluatedEvent,
): RootClientState {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return state;
  }

  const evaluation = event.evaluationResult;
  const strikeMergedGameState = state.game.gameState
    ? mergeStrikeCountsFromEvaluation(
        state.game.gameState,
        evaluation.strikeCount,
        evaluation.remainingStrikeCount,
      )
    : null;
  const nextGameState = mergeTurnStateFromEvaluation(
    strikeMergedGameState,
    event,
  );

  return {
    ...state,
    game: {
      ...state.game,
      gameState: nextGameState,
      lastTurnEvaluation: evaluation,
    },
    editor: {
      ...state.editor,
      markers: evaluation.detectedIssues ?? [],
    },
  };
}

export function applyTurnChanged(
  state: RootClientState,
  event: TurnChangedEvent,
): RootClientState {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return state;
  }

  const nextTurnState = buildTurnChangedTurnState(state, event);
  if (!nextTurnState?.turnId) {
    return state;
  }

  const previousTurnId = state.game.gameState?.turnState?.turnId;
  const nextTurnId = nextTurnState.turnId;
  const mergedMissionState =
    event.missionState === undefined || event.missionState === null
      ? state.game.missionState
      : {
          ...state.game.missionState,
          ...event.missionState,
        };
  const mergedGameState = state.game.gameState
    ? {
        ...state.game.gameState,
        turnState: nextTurnState,
      }
    : null;

  const editorWithSnapshot = applyAuthoritativeFilesToEditor(
    state.editor,
    extractAuthoritativeFilesFromMissionState(event.missionState),
    previousTurnId,
  );

  const nextEditor =
    nextTurnId && nextTurnId !== previousTurnId
      ? onEditorTurnIdChanged(editorWithSnapshot, nextTurnId)
      : editorWithSnapshot;

  let nextState: RootClientState = {
    ...state,
    game: {
      ...state.game,
      gameState: mergedGameState,
      missionState: mergedMissionState,
      turnSubmissionPending: false,
    },
    editor: {
      ...nextEditor,
      markers: [],
    },
  };

  if (state.room.currentRoom?.gameRoomId !== event.gameRoomId) {
    return nextState;
  }

  const currentRoom = state.room.currentRoom;

  return {
    ...nextState,
    room: {
      ...state.room,
      roomWaitingState: state.room.roomWaitingState
        ? {
            ...state.room.roomWaitingState,
            gameState: mergedGameState ?? state.room.roomWaitingState.gameState,
            missionState: mergedMissionState,
          }
        : state.room.roomWaitingState,
    },
  };
}

export function applyMissionResult(
  state: RootClientState,
  event: MissionResultEvent,
): ApplyMissionResultResult {
  if (!isActiveRoomRealtimeEvent(state, event.gameRoomId)) {
    return { state, navigationTarget: null };
  }

  const gameplayParticipants = resolveGameplayParticipants(state, event.gameRoomId);
  const mergedGameState = event.gameState
    ? state.game.gameState
      ? mergeGameState(state.game.gameState, event.gameState)
      : event.gameState
    : state.game.gameState;

  let nextState: RootClientState = {
    ...state,
    game: {
      ...state.game,
      gameState: mergedGameState,
      missionResult: event.missionResult,
      turnSubmissionPending: false,
    },
  };

  if (state.room.currentRoom?.gameRoomId === event.gameRoomId) {
    if (!mergedGameState) {
      return {
        state: nextState,
        navigationTarget: `/rooms/${event.gameRoomId}/result` as const,
      };
    }

    const currentRoom = mergeCurrentRoomFromGameState(
      state.room.currentRoom,
      mergedGameState,
      gameplayParticipants,
    );

    nextState = {
      ...nextState,
      room: {
        ...state.room,
        currentRoom,
        roomWaitingState: state.room.roomWaitingState
          ? {
              ...state.room.roomWaitingState,
              currentRoom,
              gameState: mergedGameState,
            }
          : state.room.roomWaitingState,
      },
    };
  }

  return {
    state: nextState,
    navigationTarget: `/rooms/${event.gameRoomId}/result` as const,
  };
}

export function parseRealtimeEventPayload<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return payload as T;
}
