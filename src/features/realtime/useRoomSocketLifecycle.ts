import { useEffect, useMemo } from "react";
import {
  useAppStore,
  useAppStoreApi,
} from "../../app/providers/ClientStateProvider";
import {
  createRoomSocketLifecycleInput,
  createStoreBackedRoomSocketLifecycleController,
  isSameRoomScopedPath,
  type RoomSocketLifecycleController,
} from "./roomSocketLifecycle";

let roomSocketLifecycleController: RoomSocketLifecycleController | null = null;

export function useRoomSocketLifecycle(
  routeGameRoomId: string | undefined,
  enabled = true,
) {
  const store = useAppStoreApi();
  const accessToken = useAppStore((state) => state.auth.accessToken);
  const currentRoom = useAppStore((state) => state.room.currentRoom);
  const userId = useAppStore((state) => state.auth.user?.userId ?? null);

  const lifecycleInput = useMemo(
    () =>
      createRoomSocketLifecycleInput({
        accessToken,
        currentRoom,
        routeGameRoomId,
        userId,
      }),
    [accessToken, currentRoom, routeGameRoomId, userId],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!roomSocketLifecycleController) {
      roomSocketLifecycleController =
        createStoreBackedRoomSocketLifecycleController(store);
    }

    roomSocketLifecycleController.sync(lifecycleInput);

    return () => {
      window.setTimeout(() => {
        if (
          !isSameRoomScopedPath(window.location.pathname, routeGameRoomId)
        ) {
          roomSocketLifecycleController?.leave(routeGameRoomId);
        }
      }, 0);
    };
  }, [enabled, lifecycleInput, routeGameRoomId, store]);
}
