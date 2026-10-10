import type { StoreApi } from "zustand/vanilla";
import type { RootClientState } from "../../shared/types/clientState";
import type { GameState } from "../../shared/types/domain";

import type { GameItemRequest, GameItemUsed, GameItemError, ItemUseState } from "../../shared/types/gameItems";

export function itemQuantity(game: GameState | null): number | undefined {
  const items = game?.items;
  if (!Array.isArray(items)) return undefined;
  const item = items.find((entry) => entry?.itemType === "TIME_EXTENSION_30");
  return item && (item.remainingQuantity === 0 || item.remainingQuantity === 1)
    ? item.remainingQuantity : undefined;
}

export function mergeItemGameState(previous: GameState | null, incoming: GameState): GameState {
  if (previous?.status === "FINISHED" && incoming.status !== "FINISHED") return previous;
  if (previous && previous.status !== "WAITING" && incoming.status === "WAITING") return previous;
  const oldTurn = previous?.turnState;
  let turnState = incoming.turnState ?? oldTurn;
  if (oldTurn && turnState) {
    if (turnState.turnNumber < oldTurn.turnNumber) turnState = oldTurn;
    else if (turnState.turnId === oldTurn.turnId) {
      turnState = {
        ...turnState,
        status: oldTurn.status !== "IN_PROGRESS" ? oldTurn.status : turnState.status,
        deadlineAt: Date.parse(oldTurn.deadlineAt) > Date.parse(turnState.deadlineAt)
          ? oldTurn.deadlineAt : turnState.deadlineAt,
      };
    }
  }
  const oldQuantity = itemQuantity(previous);
  const quantity = itemQuantity(incoming);
  const initializing = previous?.status === "WAITING" && incoming.status === "IN_PROGRESS";
  const remaining = quantity === undefined ? oldQuantity
    : oldQuantity === undefined || initializing ? quantity : Math.min(quantity, oldQuantity);
  return { ...previous, ...incoming, ...(turnState ? { turnState } : {}),
    ...(remaining === undefined ? {} : { items: [{ itemType: "TIME_EXTENSION_30" as const, remainingQuantity: remaining }] }),
  };
}

export function snapshotItemUse(state: RootClientState, snapshot: GameState): ItemUseState | undefined {
  const current = state.game.itemUse;
  if (itemQuantity(snapshot) === undefined || current?.status === "pending") return current;
  return { status: "ready", pending: null, message: current?.status === "syncing" ? "서버 상태를 확인했어요." : current?.message ?? null };
}

export function itemDisabledReason(state: RootClientState, now = Date.now()): string | null {
  const game = state.game.gameState;
  const turn = game?.turnState;
  if (state.realtime.connectionStatus !== "connected") return "실시간 연결을 확인해주세요.";
  if (state.game.itemUse?.status === "pending") return "서버에서 사용을 확인하고 있어요.";
  if (state.game.itemUse?.status === "syncing") return "아이템 상태를 확인하고 있어요.";
  if (state.game.itemUse?.status === "needs-sync" || itemQuantity(game) === undefined) return "아이템 상태를 확인해주세요.";
  if (game?.status !== "IN_PROGRESS" || turn?.status !== "IN_PROGRESS") return "진행 중인 턴에서 사용할 수 있어요.";
  if (turn.currentPlayerId !== state.auth.user?.userId) return "현재 턴 플레이어만 사용할 수 있어요.";
  if (!(Date.parse(turn.deadlineAt) > now)) return "제한시간이 끝났어요.";
  if (itemQuantity(game) === 0) return "이 방의 아이템을 모두 사용했어요.";
  if (state.game.turnSubmissionPending) return "제출 결과를 기다려주세요.";
  return null;
}

function matches(pending: GameItemRequest | null | undefined, event: GameItemError | GameItemRequest) {
  return !!pending && pending.gameRoomId === event.gameRoomId && pending.turnId === event.turnId && pending.itemType === event.itemType;
}

export function applyGameItemUsed(state: RootClientState, payload: unknown): RootClientState {
  const event = payload as GameItemUsed | null;
  if (!event || event.gameRoomId !== state.realtime.activeRoomId ||
      typeof event.turnId !== "string" || event.itemType !== "TIME_EXTENSION_30" ||
      event.remainingQuantity !== 0 || event.effect?.addedSeconds !== 30 ||
      !Number.isFinite(Date.parse(event.effect.deadlineAt)) ||
      typeof event.usedBy?.userId !== "string" || typeof event.usedBy?.nickname !== "string" ||
      !Number.isFinite(Date.parse(event.occurredAt))) return state;
  const game = state.game.gameState;
  if (!game) return state;
  const turn = game.turnState;
  const pending = state.game.itemUse?.pending;
  const itemUse: ItemUseState = {
    status: pending && !matches(pending, event) ? "pending" : "ready",
    pending: pending && !matches(pending, event) ? pending : null,
    message: `${event.usedBy.nickname}님이 시간을 30초 연장했어요.`,
  };
  return { ...state, game: { ...state.game, itemUse,
    gameState: { ...game, items: [{ itemType: event.itemType, remainingQuantity: 0 }],
      turnState: turn?.turnId === event.turnId && Date.parse(event.effect.deadlineAt) > Date.parse(turn.deadlineAt)
        ? { ...turn, deadlineAt: event.effect.deadlineAt } : turn,
    },
  } };
}

const errors: Record<string, string> = {
  TURN_PLAYER_REQUIRED: "현재 턴 플레이어만 사용할 수 있어요.",
  TURN_DEADLINE_EXPIRED: "제한시간이 끝나 아이템을 사용할 수 없어요.",
  GAME_ITEM_EXHAUSTED: "이 방의 아이템을 모두 사용했어요.",
  TURN_MISMATCH: "턴이 바뀌었어요. 현재 상태를 확인해주세요.",
  TURN_NOT_IN_PROGRESS: "이미 종료된 턴이에요.",
  GAME_ROOM_NOT_IN_PROGRESS: "진행 중인 게임에서만 사용할 수 있어요.",
  AUTH_REQUIRED: "로그인 상태를 확인해주세요.",
  FORBIDDEN_RESOURCE_ACCESS: "이 방에서 아이템을 사용할 권한이 없어요.",
  GAME_ROOM_NOT_FOUND: "게임 방을 찾을 수 없어요.",
  INVALID_GAME_ITEM_REQUEST: "아이템 요청을 처리할 수 없어요.",
};
export function applyGameItemError(state: RootClientState, payload: unknown): RootClientState {
  const event = payload as GameItemError | null;
  if (!event || event.gameRoomId !== state.realtime.activeRoomId ||
      typeof event.code !== "string" || typeof event.message !== "string" ||
      !matches(state.game.itemUse?.pending, event)) return state;
  return { ...state, game: { ...state.game, itemUse: {
    status: "needs-sync", pending: null,
    message: errors[event.code] ?? "사용 결과를 확인하지 못했어요. 서버 상태를 다시 확인해주세요.",
  } } };
}

export function createGameItemActions(
  store: StoreApi<RootClientState>,
  emit: (name: string, payload: unknown) => boolean,
  resync: () => boolean,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  function setUse(itemUse: ItemUseState) {
    store.setState((state) => ({ ...state, game: { ...state.game, itemUse } }));
  }
  function needsSync(message: string) {
    setUse({ status: "needs-sync", pending: null, message });
  }
  function syncGameItems() {
    const state = store.getState();
    if (state.realtime.connectionStatus !== "connected" || state.game.itemUse?.status === "pending" || state.game.itemUse?.status === "syncing") return false;
    clearTimeout(timer);
    const marker: ItemUseState = { status: "syncing", pending: null, message: "서버에서 아이템 상태를 확인하고 있어요." };
    setUse(marker);
    timer = setTimeout(() => {
      if (store.getState().game.itemUse === marker) needsSync("상태 확인이 지연되고 있어요. 다시 확인해주세요.");
    }, 10_000);
    try { if (resync()) return true; } catch { /* Retain unknown outcome. */ }
    clearTimeout(timer);
    needsSync("서버에 연결한 뒤 상태를 다시 확인해주세요.");
    return false;
  }
  function useGameItem() {
    const state = store.getState();
    if (itemDisabledReason(state) || !state.realtime.activeRoomId || !state.game.gameState?.turnState) return false;
    const pending: GameItemRequest = { gameRoomId: state.realtime.activeRoomId, turnId: state.game.gameState.turnState.turnId, itemType: "TIME_EXTENSION_30" };
    clearTimeout(timer);
    setUse({ status: "pending", pending, message: null });
    timer = setTimeout(() => {
      if (store.getState().game.itemUse?.pending !== pending) return;
      needsSync("사용 응답이 지연되어 서버 상태를 확인합니다.");
      syncGameItems();
    }, 10_000);
    try { if (emit("game-item-use", pending)) return true; } catch { /* Sending may have succeeded. */ }
    clearTimeout(timer);
    needsSync("사용 결과를 확인하지 못했어요. 상태를 다시 확인해주세요.");
    return false;
  }
  return { useGameItem, syncGameItems, dispose: () => clearTimeout(timer) };
}
