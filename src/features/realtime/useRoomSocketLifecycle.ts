import { useEffect, useMemo } from "react";
import {
  useAppStore,
  useAppStoreApi,
} from "../../app/providers/ClientStateProvider";
import {
  createRoomSocketLifecycleInput,
  createStoreBackedRoomSocketLifecycleController,
  shouldRetainRoomSocketForPath,
} from "./roomSocketLifecycle";

let roomSocketLifecycleController: ReturnType<typeof createStoreBackedRoomSocketLifecycleController> | null = null;

export function getRoomSocketLifecycleController() {
  return roomSocketLifecycleController;
}

export function useRoomSocketLifecycle(routeGameRoomId: string | undefined) {
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
    if (!roomSocketLifecycleController) {
      roomSocketLifecycleController =
        createStoreBackedRoomSocketLifecycleController(store);
    }

    roomSocketLifecycleController.sync(lifecycleInput);

    return () => {
      window.setTimeout(() => {
        if (
          !shouldRetainRoomSocketForPath(
            window.location.pathname,
            routeGameRoomId,
          )
        ) {
          roomSocketLifecycleController?.leave(routeGameRoomId);
        }
      }, 0);
    };
  }, [lifecycleInput, routeGameRoomId, store]);
}
