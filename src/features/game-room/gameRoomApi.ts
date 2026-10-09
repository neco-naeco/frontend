import { apiClient } from "../../shared/api/apiClient";
import type {
  CurrentGameRoom,
  CreatePracticeRoomRequest,
  CreatePracticeRoomResponse,
  GameRoomMode,
  GameRoomStatus,
  MembershipStatus,
  MissionDifficulty,
  ParticipantRole,
  StartGameRequest,
  StartGameResponse,
} from "../../shared/types/domain";

type GameRoomApiClient = Pick<typeof apiClient, "get" | "post">;

type RawCurrentGameRoom = Partial<CurrentGameRoom> & {
  id?: unknown;
};

function isGameRoomStatus(value: unknown): value is GameRoomStatus {
  return (
    value === "WAITING" ||
    value === "IN_PROGRESS" ||
    value === "JUDGING" ||
    value === "ANALYZED" ||
    value === "FINISHED"
  );
}

function isParticipantRole(value: unknown): value is ParticipantRole {
  return value === "OWNER" || value === "PARTICIPANT";
}

function isMembershipStatus(value: unknown): value is MembershipStatus {
  return value === "INVITED" || value === "JOINED" || value === "LEFT" || value === "DENIED";
}

function isMissionDifficulty(value: unknown): value is MissionDifficulty {
  return value === "EASY" || value === "NORMAL" || value === "HARD";
}

function isGameRoomMode(value: unknown): value is GameRoomMode {
  return value === "MULTIPLAYER" || value === "PRACTICE";
}

function normalizeCurrentRoom(
  room: RawCurrentGameRoom,
  userId: string,
): CurrentGameRoom | null {
  const gameRoomId =
    typeof room.gameRoomId === "string" ? room.gameRoomId : typeof room.id === "string" ? room.id : null;

  if (!gameRoomId || !isGameRoomStatus(room.status) || typeof room.ownerUserId !== "string") {
    return null;
  }

  return {
    gameRoomId,
    status: room.status,
    difficulty: isMissionDifficulty(room.difficulty) ? room.difficulty : "NORMAL",
    ownerUserId: room.ownerUserId,
    myRole: isParticipantRole(room.myRole)
      ? room.myRole
      : room.ownerUserId === userId
        ? "OWNER"
        : "PARTICIPANT",
    myMembershipStatus: isMembershipStatus(room.myMembershipStatus)
      ? room.myMembershipStatus
      : "JOINED",
    joinedParticipantCount:
      typeof room.joinedParticipantCount === "number" ? room.joinedParticipantCount : 1,
    timeLimitSeconds: typeof room.timeLimitSeconds === "number" ? room.timeLimitSeconds : 30,
    maxStrikeCount: typeof room.maxStrikeCount === "number" ? room.maxStrikeCount : 3,
    minParticipants: typeof room.minParticipants === "number" ? room.minParticipants : 2,
    maxParticipants: typeof room.maxParticipants === "number" ? room.maxParticipants : 4,
    createdAt: typeof room.createdAt === "string" ? room.createdAt : "",
    updatedAt: typeof room.updatedAt === "string" ? room.updatedAt : "",
    ...(isGameRoomMode(room.mode) ? { mode: room.mode } : {}),
  };
}

export function createGameRoomApi(client: GameRoomApiClient = apiClient) {
  return {
    async getCurrentRooms(userId: string) {
      const response = await client.get<RawCurrentGameRoom[]>(
        `/game-rooms?userId=${encodeURIComponent(userId)}`,
      );

      return (response ?? [])
        .map((room) => normalizeCurrentRoom(room, userId))
        .filter((room): room is CurrentGameRoom => room !== null);
    },
    async startGame(gameRoomId: string, request: StartGameRequest) {
      const response = await client.post<StartGameResponse>(
        `/game-rooms/${encodeURIComponent(gameRoomId)}/start`,
        request,
      );

      return response ?? { success: false };
    },
    async createPracticeRoom(request: CreatePracticeRoomRequest) {
      const response = await client.post<CreatePracticeRoomResponse>(
        "/practice-rooms",
        request,
      );

      return response ?? { success: false };
    },
  };
}

export const gameRoomApi = createGameRoomApi();
