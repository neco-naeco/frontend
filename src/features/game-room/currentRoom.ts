import type { CurrentGameRoom, CurrentGameRoomState } from "../../shared/types/domain";

type ResolveCurrentRoomOptions = {
  onDuplicateRoomsDetected?: (rooms: CurrentGameRoom[]) => void;
};

function getSortableTimestamp(room: CurrentGameRoom) {
  const updatedAt = Date.parse(room.updatedAt);

  if (!Number.isNaN(updatedAt)) {
    return updatedAt;
  }

  const createdAt = Date.parse(room.createdAt);

  return Number.isNaN(createdAt) ? 0 : createdAt;
}

export function resolveCurrentGameRoomState(
  rooms: CurrentGameRoom[],
  options: ResolveCurrentRoomOptions = {},
): CurrentGameRoomState {
  const joinedRooms = rooms.filter(
    (room) =>
      room.myMembershipStatus === "JOINED" &&
      (room.status === "WAITING" || room.status === "IN_PROGRESS"),
  );

  if (joinedRooms.length === 0) {
    return {
      currentRoom: null,
      duplicateRoomWarning: false,
    };
  }

  if (joinedRooms.length === 1) {
    return {
      currentRoom: joinedRooms[0],
      duplicateRoomWarning: false,
    };
  }

  const sortedRooms = [...joinedRooms].sort(
    (left, right) => getSortableTimestamp(right) - getSortableTimestamp(left),
  );

  options.onDuplicateRoomsDetected?.(sortedRooms);

  return {
    currentRoom: sortedRooms[0],
    duplicateRoomWarning: true,
  };
}
