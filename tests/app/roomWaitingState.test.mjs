import test from "node:test";
import assert from "node:assert/strict";
import { shouldPreserveCurrentRoomOnEmptyHttpHydration } from "../../src/pages/MainPage/mainInitialization.ts";
import { createRoomWaitingApi } from "../../src/features/room-waiting/roomWaitingApi.ts";
import {
  buildParticipantChangeSummary,
  buildRoomWaitingState,
  getMembershipStatusLabel,
  getParticipantRoleLabel,
  getRealtimeWaitingRoomSnapshot,
  isSameRoomWaitingState,
  getWaitingRoomStartButtonState,
  resolveWaitingRoomCurrentRoom,
} from "../../src/features/room-waiting/roomWaitingState.ts";

function createRoom(overrides = {}) {
  return {
    gameRoomId: "room-1",
    status: "WAITING",
    difficulty: "NORMAL",
    ownerUserId: "owner-1",
    myRole: "OWNER",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 1,
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: "2026-05-25T10:00:00Z",
    updatedAt: "2026-05-25T10:05:00Z",
    ...overrides,
  };
}

function createParticipant(overrides = {}) {
  return {
    participantId: "participant-1",
    gameRoomId: "room-1",
    userId: "user-1",
    nickname: "현하",
    role: "PARTICIPANT",
    membershipStatus: "JOINED",
    roomStatus: "WAITING",
    createdAt: "2026-05-25T10:06:00Z",
    ...overrides,
  };
}

test("createRoomWaitingApi requests participants by gameRoomId", async () => {
  const calls = [];
  const api = createRoomWaitingApi({
    async get(path, options) {
      calls.push({ path, options });
      return [createParticipant()];
    },
  });

  const result = await api.getParticipants("room 1");

  assert.equal(result.length, 1);
  assert.deepEqual(calls, [
    {
      path: "/game-room-participants?gameRoomId=room%201",
      options: undefined,
    },
  ]);
});

test("createRoomWaitingApi preserves reflected roomStatus values from participant rows", async () => {
  const api = createRoomWaitingApi({
    async get() {
      return [
        {
          participantId: "participant-1",
          gameRoomId: "room-1",
          userId: "owner-1",
          role: "OWNER",
          membershipStatus: "JOINED",
          roomStatus: "IN_PROGRESS",
          createdAt: "2026-05-25T10:06:00Z",
        },
      ];
    },
  });

  const [participant] = await api.getParticipants("room-1");

  assert.equal(participant.roomStatus, "IN_PROGRESS");
});

test("createRoomWaitingApi normalizes backend participant payloads that use id and membershipStatus", async () => {
  const api = createRoomWaitingApi({
    async get() {
      return [
        {
          id: "participant-1",
          gameRoomId: "room-1",
          userId: "owner-1",
          role: "OWNER",
          membershipStatus: "JOINED",
          createdAt: "2026-05-25T10:06:00Z",
        },
      ];
    },
  });

  const [participant] = await api.getParticipants("room-1");

  assert.deepEqual(participant, {
    participantId: "participant-1",
    gameRoomId: "room-1",
    userId: "owner-1",
    nickname: "방장",
    role: "OWNER",
    membershipStatus: "JOINED",
    roomStatus: "WAITING",
    createdAt: "2026-05-25T10:06:00Z",
  });
});

test("buildRoomWaitingState derives IN_PROGRESS gameState metadata from the current room", () => {
  const room = createRoom({
    status: "IN_PROGRESS",
    difficulty: "HARD",
    timeLimitSeconds: 45,
    maxStrikeCount: 5,
  });

  const result = buildRoomWaitingState({
    currentRoom: room,
    participants: [createParticipant()],
    currentUser: {
      userId: "owner-1",
      nickname: "방장",
    },
  });

  assert.deepEqual(result.gameState, {
    status: "IN_PROGRESS",
    difficulty: "HARD",
    timeLimitSeconds: 45,
    maxStrikeCount: 5,
    minParticipants: 2,
    maxParticipants: 4,
  });
});

test("buildRoomWaitingState maps participant query results into waiting-room state", () => {
  const room = createRoom({
    myRole: "PARTICIPANT",
    ownerUserId: "owner-1",
    joinedParticipantCount: 2,
  });
  const previousState = {
    currentRoom: room,
    participants: [
      {
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
  };

  const result = buildRoomWaitingState({
    currentRoom: room,
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
      }),
      createParticipant(),
    ],
    previousState,
    currentUser: {
      userId: "user-1",
      nickname: "현하",
    },
  });

  assert.deepEqual(result.participants, [
    {
      userId: "owner-1",
      nickname: "방장",
      role: "OWNER",
      membershipStatus: "JOINED",
    },
    {
      userId: "user-1",
      nickname: "현하",
      role: "PARTICIPANT",
      membershipStatus: "JOINED",
    },
  ]);
  assert.deepEqual(result.changedParticipant, {
    userId: "user-1",
    nickname: "현하",
    role: "PARTICIPANT",
    membershipStatus: "JOINED",
  });
  assert.equal(result.currentRoom.joinedParticipantCount, 2);
});

test("buildRoomWaitingState rebuilds gameState when the same room transitions WAITING to IN_PROGRESS", () => {
  const previousState = {
    currentRoom: createRoom({ gameRoomId: "room-1", status: "WAITING" }),
    participants: [],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom({ gameRoomId: "room-1", status: "IN_PROGRESS" }),
    participants: [],
    previousState,
    currentUser: {
      userId: "owner-1",
      nickname: "방장",
    },
  });

  assert.equal(result.gameState.status, "IN_PROGRESS");
});

test("buildRoomWaitingState resets gameState and missionState when the current room changes", () => {
  const result = buildRoomWaitingState({
    currentRoom: createRoom({ gameRoomId: "room-new" }),
    participants: [],
    previousState: {
      currentRoom: createRoom({ gameRoomId: "room-old" }),
      participants: [],
      changedParticipant: null,
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 2,
        maxStrikeCount: 1,
      },
      missionState: {
        missionId: "mission-old",
      },
    },
    currentUser: {
      userId: "owner-1",
      nickname: "방장",
    },
  });

  assert.deepEqual(result.gameState, {
    status: "WAITING",
    difficulty: "NORMAL",
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    minParticipants: 2,
    maxParticipants: 4,
  });
  assert.equal(result.missionState, null);
});

test("buildRoomWaitingState keeps changedParticipant null on first waiting-room hydration", () => {
  const room = createRoom({
    joinedParticipantCount: 2,
  });

  const result = buildRoomWaitingState({
    currentRoom: room,
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
      }),
      createParticipant(),
    ],
    currentUser: {
      userId: "user-1",
      nickname: "현하",
    },
  });

  assert.equal(result.changedParticipant, null);
});

test("buildRoomWaitingState falls back to the current user when the participant query is empty", () => {
  const room = createRoom();

  const result = buildRoomWaitingState({
    currentRoom: room,
    participants: [],
    currentUser: {
      userId: "owner-1",
      nickname: "방장",
    },
  });

  assert.deepEqual(result.participants, [
    {
      userId: "owner-1",
      nickname: "방장",
      role: "OWNER",
      membershipStatus: "JOINED",
    },
  ]);
});

test("getWaitingRoomStartButtonState follows the owner and minimum participant rules", () => {
  assert.deepEqual(getWaitingRoomStartButtonState(createRoom()), {
    canShowStartButton: true,
    canClickStartButton: false,
  });

  assert.deepEqual(
    getWaitingRoomStartButtonState(
      createRoom({
        joinedParticipantCount: 2,
      }),
    ),
    {
      canShowStartButton: true,
      canClickStartButton: true,
    },
  );

  assert.deepEqual(
    getWaitingRoomStartButtonState(
      createRoom({
        myRole: "PARTICIPANT",
        joinedParticipantCount: 3,
      }),
    ),
    {
      canShowStartButton: false,
      canClickStartButton: false,
    },
  );
});

test("getWaitingRoomStartButtonState hides the start CTA for IN_PROGRESS rooms", () => {
  assert.deepEqual(
    getWaitingRoomStartButtonState(
      createRoom({
        status: "IN_PROGRESS",
        joinedParticipantCount: 4,
      }),
    ),
    {
      canShowStartButton: false,
      canClickStartButton: false,
    },
  );
});

test("buildRoomWaitingState keeps realtime IN_PROGRESS snapshot when http room is still WAITING", () => {
  const httpRoom = createRoom({ status: "WAITING", joinedParticipantCount: 2 });
  const realtimeSnapshot = {
    gameState: {
      status: "IN_PROGRESS",
      strikeCount: 0,
      maxStrikeCount: 3,
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "owner-1",
        startedAt: "2026-05-25T10:10:00Z",
        deadlineAt: "2026-05-25T10:10:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 30,
        status: "IN_PROGRESS",
      },
    },
    missionState: {
      missionId: "mission-1",
      title: "짝수 찾기",
    },
  };

  const result = buildRoomWaitingState({
    currentRoom: httpRoom,
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
      }),
      createParticipant(),
    ],
    previousState: {
      currentRoom: { ...httpRoom, status: "IN_PROGRESS" },
      participants: [
        {
          userId: "owner-1",
          nickname: "방장",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
        {
          userId: "user-1",
          nickname: "현하",
          role: "PARTICIPANT",
          membershipStatus: "JOINED",
        },
      ],
      changedParticipant: null,
      gameState: realtimeSnapshot.gameState,
      missionState: realtimeSnapshot.missionState,
    },
    currentUser: {
      userId: "owner-1",
      nickname: "방장",
    },
    realtimeSnapshot,
  });

  assert.equal(result.gameState.status, "IN_PROGRESS");
  assert.equal(result.currentRoom.status, "IN_PROGRESS");
  assert.equal(result.missionState?.missionId, "mission-1");
});

test("getRealtimeWaitingRoomSnapshot exposes active-room gameplay state for /main hydration", () => {
  const snapshot = getRealtimeWaitingRoomSnapshot(
    {
      game: {
        gameState: { status: "IN_PROGRESS" },
        missionState: { missionId: "mission-1" },
      },
      realtime: { activeRoomId: "room-1" },
    },
    "room-1",
  );

  assert.deepEqual(snapshot, {
    gameState: { status: "IN_PROGRESS" },
    missionState: { missionId: "mission-1" },
  });
});

test("shouldPreserveCurrentRoomOnEmptyHttpHydration stays true while active room id matches store room", () => {
  assert.equal(
    shouldPreserveCurrentRoomOnEmptyHttpHydration({
      room: { currentRoom: createRoom({ status: "IN_PROGRESS" }) },
      realtime: { activeRoomId: "room-1", participants: [] },
      game: {
        gameState: { status: "IN_PROGRESS" },
        missionState: null,
      },
    }),
    true,
  );
});

test("resolveWaitingRoomCurrentRoom prefers realtime-merged room metadata over stale http WAITING", () => {
  const httpRoom = createRoom({ status: "WAITING" });
  const realtimeSnapshot = {
    gameState: { status: "IN_PROGRESS" },
    missionState: null,
  };

  const resolved = resolveWaitingRoomCurrentRoom({
    httpRoom,
    storeCurrentRoom: { ...httpRoom, status: "IN_PROGRESS" },
    realtimeSnapshot,
    participants: [
      {
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
  });

  assert.equal(resolved.status, "IN_PROGRESS");
});

test("buildParticipantChangeSummary describes membership changes for waiting-room cards", () => {
  assert.equal(
    buildParticipantChangeSummary({
      userId: "user-1",
      nickname: "현하",
      role: "PARTICIPANT",
      membershipStatus: "LEFT",
    }),
    "현하님이 대기방에서 나갔어요.",
  );
});

test("status and role labels stay user-facing", () => {
  assert.equal(getMembershipStatusLabel("DENIED"), "거절됨");
  assert.equal(getParticipantRoleLabel("OWNER"), "방장");
});

test("isSameRoomWaitingState returns true for semantically identical waiting-room state", () => {
  const left = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
      }),
      createParticipant(),
    ],
    currentUser: {
      userId: "user-1",
      nickname: "현하",
    },
  });

  const right = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
      }),
      createParticipant(),
    ],
    currentUser: {
      userId: "user-1",
      nickname: "현하",
    },
  });

  assert.equal(isSameRoomWaitingState(left, right), true);
});

test("getRealtimeWaitingRoomSnapshot returns null for inactive rooms and missing game state", () => {
  assert.equal(
    getRealtimeWaitingRoomSnapshot(
      {
        game: {
          gameState: { status: "IN_PROGRESS" },
          missionState: { missionId: "mission-1" },
        },
        realtime: { activeRoomId: "room-2" },
      },
      "room-1",
    ),
    null,
  );

  assert.equal(
    getRealtimeWaitingRoomSnapshot(
      {
        game: {
          gameState: null,
          missionState: { missionId: "mission-1" },
        },
        realtime: { activeRoomId: "room-1" },
      },
      "room-1",
    ),
    null,
  );
});

test("resolveWaitingRoomCurrentRoom reuses the store room when realtime status already matches", () => {
  const httpRoom = createRoom({
    status: "WAITING",
    difficulty: "NORMAL",
    joinedParticipantCount: 1,
  });
  const storeCurrentRoom = createRoom({
    status: "IN_PROGRESS",
    difficulty: "HARD",
    joinedParticipantCount: 3,
    updatedAt: "2026-05-25T10:20:00Z",
  });
  const realtimeSnapshot = {
    gameState: {
      status: "IN_PROGRESS",
      difficulty: "HARD",
      timeLimitSeconds: 60,
      maxStrikeCount: 5,
    },
    missionState: { missionId: "mission-1" },
  };

  const resolved = resolveWaitingRoomCurrentRoom({
    httpRoom,
    storeCurrentRoom,
    realtimeSnapshot,
    participants: [
      {
        userId: "owner-1",
        nickname: "Owner",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
  });

  assert.equal(resolved, storeCurrentRoom);
});

test("resolveWaitingRoomCurrentRoom merges realtime metadata when store room is stale", () => {
  const httpRoom = createRoom({
    status: "WAITING",
    difficulty: "NORMAL",
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    joinedParticipantCount: 1,
  });

  const resolved = resolveWaitingRoomCurrentRoom({
    httpRoom,
    storeCurrentRoom: createRoom({
      status: "WAITING",
      difficulty: "NORMAL",
      joinedParticipantCount: 1,
    }),
    realtimeSnapshot: {
      gameState: {
        status: "IN_PROGRESS",
        difficulty: "HARD",
        timeLimitSeconds: 45,
        maxStrikeCount: 5,
        minParticipants: 2,
        maxParticipants: 5,
      },
      missionState: { missionId: "mission-1" },
    },
    participants: [
      {
        userId: "owner-1",
        nickname: "Owner",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-2",
        nickname: "Beta",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
  });

  assert.equal(resolved.status, "IN_PROGRESS");
  assert.equal(resolved.difficulty, "HARD");
  assert.equal(resolved.timeLimitSeconds, 45);
  assert.equal(resolved.maxStrikeCount, 5);
  assert.equal(resolved.maxParticipants, 5);
  assert.equal(resolved.joinedParticipantCount, 2);
});

test("resolveWaitingRoomCurrentRoom uses http room when no realtime snapshot is available", () => {
  const httpRoom = createRoom({
    status: "WAITING",
    difficulty: "EASY",
  });

  const resolved = resolveWaitingRoomCurrentRoom({
    httpRoom,
    storeCurrentRoom: createRoom({
      status: "IN_PROGRESS",
      difficulty: "HARD",
    }),
    realtimeSnapshot: null,
    participants: [],
  });

  assert.equal(resolved, httpRoom);
});

test("buildRoomWaitingState prioritizes the current user when multiple participant changes arrive", () => {
  const previousState = {
    currentRoom: createRoom(),
    participants: [
      {
        userId: "owner-1",
        nickname: "Owner",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-1",
        nickname: "Alpha",
        role: "PARTICIPANT",
        membershipStatus: "INVITED",
      },
      {
        userId: "user-2",
        nickname: "Beta",
        role: "PARTICIPANT",
        membershipStatus: "INVITED",
      },
    ],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom({
      joinedParticipantCount: 3,
    }),
    participants: [
      createParticipant({
        userId: "owner-1",
        nickname: "Owner",
        role: "OWNER",
        membershipStatus: "JOINED",
      }),
      createParticipant({
        userId: "user-1",
        nickname: "Alpha",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      }),
      createParticipant({
        userId: "user-2",
        nickname: "Beta",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      }),
    ],
    previousState,
    currentUser: {
      userId: "user-1",
      nickname: "Alpha",
    },
  });

  assert.deepEqual(result.changedParticipant, {
    userId: "user-1",
    nickname: "Alpha",
    role: "PARTICIPANT",
    membershipStatus: "JOINED",
  });
});

test("buildRoomWaitingState detects nickname and role changes as participant updates", () => {
  const previousState = {
    currentRoom: createRoom(),
    participants: [
      {
        userId: "user-1",
        nickname: "Old nickname",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [
      createParticipant({
        userId: "user-1",
        nickname: "New nickname",
        role: "OWNER",
        membershipStatus: "JOINED",
      }),
    ],
    previousState,
    currentUser: {
      userId: "user-2",
      nickname: "Viewer",
    },
  });

  assert.deepEqual(result.changedParticipant, {
    userId: "user-1",
    nickname: "New nickname",
    role: "OWNER",
    membershipStatus: "JOINED",
  });
});

test("buildRoomWaitingState keeps previous gameplay snapshot when room metadata is unchanged", () => {
  const previousGameState = {
    status: "WAITING",
    difficulty: "NORMAL",
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    minParticipants: 2,
    maxParticipants: 4,
    customServerField: "preserved",
  };
  const previousMissionState = {
    missionId: "mission-preserved",
    title: "Preserved mission",
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [createParticipant()],
    previousState: {
      currentRoom: createRoom(),
      participants: [
        {
          userId: "user-1",
          nickname: "?꾪븯",
          role: "PARTICIPANT",
          membershipStatus: "JOINED",
        },
      ],
      changedParticipant: null,
      gameState: previousGameState,
      missionState: previousMissionState,
    },
    currentUser: {
      userId: "user-1",
      nickname: "?꾪븯",
    },
  });

  assert.equal(result.gameState, previousGameState);
  assert.equal(result.missionState, previousMissionState);
});

test("buildRoomWaitingState rebuilds game metadata when difficulty or limits change", () => {
  const previousState = {
    currentRoom: createRoom({
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
    }),
    participants: [],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "NORMAL",
      timeLimitSeconds: 30,
      maxStrikeCount: 3,
      minParticipants: 2,
      maxParticipants: 4,
      customServerField: "should drop",
    },
    missionState: { missionId: "mission-old" },
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom({
      difficulty: "HARD",
      timeLimitSeconds: 45,
      maxStrikeCount: 5,
      minParticipants: 3,
      maxParticipants: 6,
    }),
    participants: [],
    previousState,
    currentUser: {
      userId: "owner-1",
      nickname: "Owner",
    },
  });

  assert.deepEqual(result.gameState, {
    status: "WAITING",
    difficulty: "HARD",
    timeLimitSeconds: 45,
    maxStrikeCount: 5,
    minParticipants: 3,
    maxParticipants: 6,
  });
  assert.deepEqual(result.missionState, { missionId: "mission-old" });
});

test("buildRoomWaitingState keeps room participant count when all reflected participants are non-joined", () => {
  const result = buildRoomWaitingState({
    currentRoom: createRoom({
      joinedParticipantCount: 2,
    }),
    participants: [
      createParticipant({
        userId: "user-1",
        membershipStatus: "LEFT",
      }),
      createParticipant({
        userId: "user-2",
        membershipStatus: "DENIED",
      }),
    ],
    currentUser: {
      userId: "owner-1",
      nickname: "Owner",
    },
  });

  assert.equal(result.currentRoom.joinedParticipantCount, 2);
  assert.deepEqual(
    result.participants.map((participant) => participant.membershipStatus),
    ["LEFT", "DENIED"],
  );
});

test("buildRoomWaitingState applies realtime mission snapshot over previous mission state", () => {
  const result = buildRoomWaitingState({
    currentRoom: createRoom({
      status: "WAITING",
      joinedParticipantCount: 1,
    }),
    participants: [createParticipant()],
    previousState: {
      currentRoom: createRoom(),
      participants: [],
      changedParticipant: null,
      gameState: {
        status: "WAITING",
      },
      missionState: {
        missionId: "mission-old",
      },
    },
    currentUser: {
      userId: "user-1",
      nickname: "?꾪븯",
    },
    realtimeSnapshot: {
      gameState: {
        status: "IN_PROGRESS",
        difficulty: "HARD",
        timeLimitSeconds: 60,
        maxStrikeCount: 5,
      },
      missionState: {
        missionId: "mission-new",
        title: "Realtime mission",
      },
    },
  });

  assert.equal(result.gameState.status, "IN_PROGRESS");
  assert.equal(result.currentRoom.status, "IN_PROGRESS");
  assert.equal(result.currentRoom.difficulty, "HARD");
  assert.equal(result.missionState.missionId, "mission-new");
});

test("getWaitingRoomStartButtonState keeps owner start disabled below minimum participants", () => {
  const result = getWaitingRoomStartButtonState(
    createRoom({
      myRole: "OWNER",
      joinedParticipantCount: 1,
      minParticipants: 3,
      status: "WAITING",
    }),
  );

  assert.deepEqual(result, {
    canShowStartButton: true,
    canClickStartButton: false,
  });
});

test("getWaitingRoomStartButtonState allows owner start exactly at the participant minimum", () => {
  const result = getWaitingRoomStartButtonState(
    createRoom({
      myRole: "OWNER",
      joinedParticipantCount: 3,
      minParticipants: 3,
      status: "WAITING",
    }),
  );

  assert.deepEqual(result, {
    canShowStartButton: true,
    canClickStartButton: true,
  });
});

test("getWaitingRoomStartButtonState hides start when owner already left the room", () => {
  const result = getWaitingRoomStartButtonState(
    createRoom({
      myRole: "OWNER",
      myMembershipStatus: "LEFT",
      joinedParticipantCount: 4,
      minParticipants: 2,
      status: "WAITING",
    }),
  );

  assert.deepEqual(result, {
    canShowStartButton: true,
    canClickStartButton: true,
  });
});

test("status and role label helpers return stable non-empty copy for all reflected values", () => {
  for (const status of ["INVITED", "JOINED", "LEFT", "DENIED", "UNKNOWN"]) {
    const label = getMembershipStatusLabel(status);

    assert.equal(typeof label, "string");
    assert.ok(label.length > 0);
  }

  for (const role of ["OWNER", "PARTICIPANT", "UNKNOWN"]) {
    const label = getParticipantRoleLabel(role);

    assert.equal(typeof label, "string");
    assert.ok(label.length > 0);
  }
});

test("buildParticipantChangeSummary includes the participant nickname for every membership transition", () => {
  for (const membershipStatus of ["INVITED", "JOINED", "LEFT", "DENIED", "UNKNOWN"]) {
    const summary = buildParticipantChangeSummary({
      userId: "user-1",
      nickname: "Alpha",
      role: "PARTICIPANT",
      membershipStatus,
    });

    assert.equal(typeof summary, "string");
    assert.ok(summary.includes("Alpha"));
  }
});

test("buildParticipantChangeSummary returns null when there is no changed participant", () => {
  assert.equal(buildParticipantChangeSummary(null), null);
});

test("isSameRoomWaitingState detects current room, participant, and mission changes", () => {
  const base = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [createParticipant()],
    currentUser: {
      userId: "user-1",
      nickname: "?꾪븯",
    },
  });

  const changedRoom = {
    ...base,
    currentRoom: {
      ...base.currentRoom,
      joinedParticipantCount: base.currentRoom.joinedParticipantCount + 1,
    },
  };
  const changedParticipant = {
    ...base,
    participants: [
      {
        ...base.participants[0],
        nickname: "Changed",
      },
    ],
  };
  const changedGameState = {
    ...base,
    gameState: {
      ...base.gameState,
      difficulty: "HARD",
    },
  };
  const changedMissionState = {
    ...base,
    missionState: {
      missionId: "mission-1",
    },
  };

  assert.equal(isSameRoomWaitingState(base, changedRoom), false);
  assert.equal(isSameRoomWaitingState(base, changedParticipant), false);
  assert.equal(isSameRoomWaitingState(base, changedGameState), false);
  assert.equal(isSameRoomWaitingState(base, changedMissionState), false);
  assert.equal(isSameRoomWaitingState(base, null), false);
  assert.equal(isSameRoomWaitingState(null, null), true);
});

test("shouldPreserveCurrentRoomOnEmptyHttpHydration rejects inactive or mismatched room state", () => {
  assert.equal(
    shouldPreserveCurrentRoomOnEmptyHttpHydration({
      room: { currentRoom: createRoom({ gameRoomId: "room-1" }) },
      realtime: { activeRoomId: null, participants: [] },
      game: {
        gameState: { status: "IN_PROGRESS" },
        missionState: null,
      },
    }),
    false,
  );
  assert.equal(
    shouldPreserveCurrentRoomOnEmptyHttpHydration({
      room: { currentRoom: createRoom({ gameRoomId: "room-1" }) },
      realtime: { activeRoomId: "room-2", participants: [] },
      game: {
        gameState: { status: "IN_PROGRESS" },
        missionState: null,
      },
    }),
    false,
  );
  assert.equal(
    shouldPreserveCurrentRoomOnEmptyHttpHydration({
      room: { currentRoom: null },
      realtime: { activeRoomId: "room-1", participants: [] },
      game: {
        gameState: { status: "IN_PROGRESS" },
        missionState: null,
      },
    }),
    false,
  );
});

test("buildRoomWaitingState does not report a changed participant when participant snapshots are equal", () => {
  const participant = {
    userId: "user-1",
    nickname: "Alpha",
    role: "PARTICIPANT",
    membershipStatus: "JOINED",
  };

  const result = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [
      createParticipant({
        userId: participant.userId,
        nickname: participant.nickname,
        role: participant.role,
        membershipStatus: participant.membershipStatus,
      }),
    ],
    previousState: {
      currentRoom: createRoom(),
      participants: [participant],
      changedParticipant: null,
      gameState: {
        status: "WAITING",
        difficulty: "NORMAL",
        timeLimitSeconds: 30,
        maxStrikeCount: 3,
        minParticipants: 2,
        maxParticipants: 4,
      },
      missionState: null,
    },
    currentUser: {
      userId: "user-1",
      nickname: "Alpha",
    },
  });

  assert.equal(result.changedParticipant, null);
});

test("buildRoomWaitingState reports the first changed participant when current user is unchanged", () => {
  const result = buildRoomWaitingState({
    currentRoom: createRoom({
      joinedParticipantCount: 3,
    }),
    participants: [
      createParticipant({
        userId: "user-1",
        nickname: "Alpha",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      }),
      createParticipant({
        userId: "user-2",
        nickname: "Beta",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      }),
      createParticipant({
        userId: "user-3",
        nickname: "Gamma",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      }),
    ],
    previousState: {
      currentRoom: createRoom({
        joinedParticipantCount: 1,
      }),
      participants: [
        {
          userId: "user-1",
          nickname: "Alpha",
          role: "PARTICIPANT",
          membershipStatus: "JOINED",
        },
      ],
      changedParticipant: null,
      gameState: {
        status: "WAITING",
        difficulty: "NORMAL",
        timeLimitSeconds: 30,
        maxStrikeCount: 3,
        minParticipants: 2,
        maxParticipants: 4,
      },
      missionState: null,
    },
    currentUser: {
      userId: "user-1",
      nickname: "Alpha",
    },
  });

  assert.deepEqual(result.changedParticipant, {
    userId: "user-2",
    nickname: "Beta",
    role: "PARTICIPANT",
    membershipStatus: "JOINED",
  });
});

test("buildRoomWaitingState converts participant API rows without leaking API-only fields", () => {
  const result = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [
      createParticipant({
        participantId: "participant-api-only",
        gameRoomId: "room-1",
        roomStatus: "WAITING",
        createdAt: "2026-05-25T10:06:00Z",
      }),
    ],
    currentUser: {
      userId: "user-1",
      nickname: "?꾪븯",
    },
  });

  assert.deepEqual(Object.keys(result.participants[0]).sort(), [
    "membershipStatus",
    "nickname",
    "role",
    "userId",
  ]);
});

test("resolveWaitingRoomCurrentRoom keeps joined count from current room when realtime participants are empty", () => {
  const resolved = resolveWaitingRoomCurrentRoom({
    httpRoom: createRoom({
      joinedParticipantCount: 4,
    }),
    storeCurrentRoom: null,
    realtimeSnapshot: {
      gameState: {
        status: "IN_PROGRESS",
        difficulty: "NORMAL",
        timeLimitSeconds: 30,
        maxStrikeCount: 3,
      },
      missionState: null,
    },
    participants: [],
  });

  assert.equal(resolved.status, "IN_PROGRESS");
  assert.equal(resolved.joinedParticipantCount, 4);
});

test("isSameRoomWaitingState detects changedParticipant differences", () => {
  const base = buildRoomWaitingState({
    currentRoom: createRoom(),
    participants: [createParticipant()],
    currentUser: {
      userId: "user-1",
      nickname: "?꾪븯",
    },
  });
  const withChangedParticipant = {
    ...base,
    changedParticipant: {
      userId: "user-2",
      nickname: "Beta",
      role: "PARTICIPANT",
      membershipStatus: "JOINED",
    },
  };

  assert.equal(isSameRoomWaitingState(base, withChangedParticipant), false);
});
