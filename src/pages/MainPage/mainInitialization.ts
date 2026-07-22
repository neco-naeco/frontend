import { mergeCurrentRoomFromGameState } from "../../features/realtime/realtimeEventReducers";
import {
  getRealtimeWaitingRoomSnapshot,
  resolveWaitingRoomCurrentRoom,
} from "../../features/room-waiting/roomWaitingState";
import { resolveCurrentGameRoomState } from "../../features/game-room/currentRoom";
import type { RootClientState } from "../../shared/types/clientState";
import type {
  CurrentGameRoom,
  CurrentGameRoomState,
  GameRoomParticipant,
  GameRoomStatus,
  GameState,
  MissionState,
  RoomWaitingParticipant,
} from "../../shared/types/domain";
import { getUserFacingErrorMessage } from "../../shared/utils/appError";

export function isMainPageRoomContextStatus(status: GameRoomStatus) {
  return status === "WAITING" || status === "IN_PROGRESS";
}

export function resolveMainPageRoomContextRoom(
  currentRoom: CurrentGameRoom | null | undefined,
): CurrentGameRoom | null {
  if (!currentRoom || !isMainPageRoomContextStatus(currentRoom.status)) {
    return null;
  }

  return currentRoom;
}

type MainInitializationDependencies = {
  getCurrentRooms: (userId: string) => Promise<CurrentGameRoom[]>;
  getInvitedParticipants: (userId: string) => Promise<GameRoomParticipant[]>;
};

type LoadCurrentRoomStateOptions = {
  userId: string;
  getCurrentRooms: MainInitializationDependencies["getCurrentRooms"];
  onDuplicateRoomsDetected?: (rooms: CurrentGameRoom[]) => void;
};

type LoadInvitationsOptions = {
  userId: string;
  getInvitedParticipants: MainInitializationDependencies["getInvitedParticipants"];
};

type QuerySnapshot<T> = {
  data: T | undefined;
  error: unknown | null;
  isPending: boolean;
};

export type MainPageInitializationView = {
  status: "loading" | "ready" | "error";
  currentRoomState: CurrentGameRoomState;
  invitations: GameRoomParticipant[];
  blockingErrorMessage: string | null;
  currentRoomErrorMessage: string | null;
  invitationErrorMessage: string | null;
};

export async function loadCurrentRoomState({
  userId,
  getCurrentRooms,
  onDuplicateRoomsDetected,
}: LoadCurrentRoomStateOptions): Promise<CurrentGameRoomState> {
  const rooms = await getCurrentRooms(userId);

  return resolveCurrentGameRoomState(rooms, {
    onDuplicateRoomsDetected,
  });
}

export async function loadInvitations({
  userId,
  getInvitedParticipants,
}: LoadInvitationsOptions): Promise<GameRoomParticipant[]> {
  return getInvitedParticipants(userId);
}

export function deriveMainPageInitializationView({
  currentRoomQuery,
  invitationQuery,
}: {
  currentRoomQuery: QuerySnapshot<CurrentGameRoomState>;
  invitationQuery: QuerySnapshot<GameRoomParticipant[]>;
}): MainPageInitializationView {
  const hasCurrentRoomData = currentRoomQuery.data !== undefined;
  const hasInvitationData = invitationQuery.data !== undefined;

  if (!hasCurrentRoomData && !hasInvitationData) {
    if (currentRoomQuery.isPending || invitationQuery.isPending) {
      return {
        status: "loading",
        currentRoomState: {
          currentRoom: null,
          duplicateRoomWarning: false,
        },
        invitations: [],
        blockingErrorMessage: null,
        currentRoomErrorMessage: null,
        invitationErrorMessage: null,
      };
    }

    return {
      status: "error",
      currentRoomState: {
        currentRoom: null,
        duplicateRoomWarning: false,
      },
      invitations: [],
      blockingErrorMessage: getUserFacingErrorMessage(
        currentRoomQuery.error ?? invitationQuery.error,
      ),
      currentRoomErrorMessage: null,
      invitationErrorMessage: null,
    };
  }

  const currentRoomState = currentRoomQuery.data ?? {
    currentRoom: null,
    duplicateRoomWarning: false,
  };
  const activeInvitations = invitationQuery.data ?? [];
  const shouldPrioritizeInvitation =
    Boolean(currentRoomState.currentRoom) &&
    currentRoomState.currentRoom?.myRole !== "OWNER" &&
    activeInvitations.some(
      (invitation) => invitation.gameRoomId === currentRoomState.currentRoom?.gameRoomId,
    );
  const resolvedCurrentRoomState = shouldPrioritizeInvitation
    ? {
        ...currentRoomState,
        currentRoom: null,
      }
    : currentRoomState;
  const hasCurrentRoom = Boolean(resolvedCurrentRoomState.currentRoom);

  return {
    status: "ready",
    currentRoomState: resolvedCurrentRoomState,
    invitations: hasCurrentRoom ? [] : activeInvitations,
    blockingErrorMessage: null,
    currentRoomErrorMessage:
      currentRoomQuery.error && !hasCurrentRoomData
        ? getUserFacingErrorMessage(currentRoomQuery.error)
        : null,
    invitationErrorMessage:
      !hasCurrentRoom && invitationQuery.error && !hasInvitationData
        ? getUserFacingErrorMessage(invitationQuery.error)
        : null,
  };
}

type MainPageRealtimeRoomContextInput = {
  room: Pick<RootClientState["room"], "currentRoom">;
  realtime: Pick<RootClientState["realtime"], "activeRoomId" | "participants">;
  game: Pick<RootClientState["game"], "gameState" | "missionState">;
};

export function shouldPreserveCurrentRoomOnEmptyHttpHydration(
  state: MainPageRealtimeRoomContextInput,
) {
  const activeRoomId = state.realtime.activeRoomId;
  const storeRoom = state.room.currentRoom;
  if (!activeRoomId || storeRoom?.gameRoomId !== activeRoomId) {
    return false;
  }

  if (state.game.gameState) {
    return (
      resolveMainPageRoomContextRoom(
        mergeCurrentRoomFromGameState(
          storeRoom,
          state.game.gameState,
          state.realtime.participants,
        ),
      ) !== null
    );
  }

  return resolveMainPageRoomContextRoom(storeRoom) !== null;
}

export function resolveCurrentRoomAfterHttpHydration(
  httpRoom: CurrentGameRoom | null,
  state: MainPageRealtimeRoomContextInput,
): CurrentGameRoom | null {
  if (httpRoom) {
    const realtimeSnapshot = getRealtimeWaitingRoomSnapshot(state, httpRoom.gameRoomId);

    return resolveWaitingRoomCurrentRoom({
      httpRoom,
      storeCurrentRoom: state.room.currentRoom,
      realtimeSnapshot,
      participants: state.realtime.participants,
    });
  }

  if (!shouldPreserveCurrentRoomOnEmptyHttpHydration(state)) {
    return null;
  }

  const storeRoom = state.room.currentRoom;
  if (!storeRoom) {
    return null;
  }

  const realtimeSnapshot = getRealtimeWaitingRoomSnapshot(state, storeRoom.gameRoomId);
  if (realtimeSnapshot) {
    return resolveMainPageRoomContextRoom(
      mergeCurrentRoomFromGameState(
        storeRoom,
        realtimeSnapshot.gameState,
        state.realtime.participants,
      ),
    );
  }

  return resolveMainPageRoomContextRoom(storeRoom);
}

export function resolveMainPageWaitingRoomCurrentRoom({
  httpRoom,
  storeCurrentRoom,
  activeRoomId,
  gameState,
  missionState,
  participants,
  invitations = [],
}: {
  httpRoom: CurrentGameRoom | null | undefined;
  storeCurrentRoom: CurrentGameRoom | null;
  activeRoomId: string | null;
  gameState: GameState | null;
  missionState: MissionState | null;
  participants: RoomWaitingParticipant[];
  invitations?: GameRoomParticipant[];
}): CurrentGameRoom | null {
  const httpContextRoom = resolveMainPageRoomContextRoom(httpRoom);
  if (httpContextRoom) {
    const realtimeSnapshot =
      activeRoomId === httpContextRoom.gameRoomId && gameState
        ? { gameState, missionState }
        : null;

    return resolveWaitingRoomCurrentRoom({
      httpRoom: httpContextRoom,
      storeCurrentRoom,
      realtimeSnapshot,
      participants,
    });
  }

  if (!activeRoomId || !storeCurrentRoom || storeCurrentRoom.gameRoomId !== activeRoomId) {
    return null;
  }

  if (invitations.some((invitation) => invitation.gameRoomId === storeCurrentRoom.gameRoomId)) {
    return null;
  }

  if (!gameState) {
    return resolveMainPageRoomContextRoom(storeCurrentRoom);
  }

  return resolveMainPageRoomContextRoom(
    mergeCurrentRoomFromGameState(storeCurrentRoom, gameState, participants),
  );
}

export function resolveMainPageDisplayCurrentRoom({
  httpCurrentRoom,
  waitingRoomCurrentRoom,
}: {
  httpCurrentRoom: CurrentGameRoom | null | undefined;
  waitingRoomCurrentRoom: CurrentGameRoom | null;
}): CurrentGameRoom | null {
  return waitingRoomCurrentRoom ?? httpCurrentRoom ?? null;
}

export function resolveMainPageVisibleInvitations({
  displayCurrentRoom,
  invitations,
}: {
  displayCurrentRoom: CurrentGameRoom | null;
  invitations: GameRoomParticipant[];
}): GameRoomParticipant[] {
  if (displayCurrentRoom) {
    return [];
  }

  return invitations;
}
