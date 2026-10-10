export type GameItemType = "TIME_EXTENSION_30";
export type GameItemState = { itemType: GameItemType; remainingQuantity: number };
export type GameItemRequest = {
  gameRoomId: string;
  turnId: string;
  itemType: GameItemType;
};
export type ItemUseState = {
  status: "ready" | "pending" | "needs-sync" | "syncing";
  pending: GameItemRequest | null;
  message: string | null;
};
export type GameItemUsed = GameItemRequest & {
  usedBy: { userId: string; nickname: string };
  remainingQuantity: number;
  effect: { addedSeconds: 30; deadlineAt: string };
  occurredAt: string;
};
export type GameItemErrorCode =
  | "INVALID_GAME_ITEM_REQUEST"
  | "AUTH_REQUIRED"
  | "FORBIDDEN_RESOURCE_ACCESS"
  | "GAME_ROOM_NOT_FOUND"
  | "GAME_ROOM_NOT_IN_PROGRESS"
  | "TURN_MISMATCH"
  | "TURN_PLAYER_REQUIRED"
  | "TURN_NOT_IN_PROGRESS"
  | "TURN_DEADLINE_EXPIRED"
  | "GAME_ITEM_EXHAUSTED"
  | "GAME_ITEM_INTERNAL_ERROR";

export type GameItemError = {
  gameRoomId: string | null;
  turnId: string | null;
  itemType: GameItemType | null;
  code: GameItemErrorCode;
  message: string;
  occurredAt: string;
};
