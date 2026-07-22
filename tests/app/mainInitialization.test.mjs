import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore, resetAppStoreForLogout } from "../../src/app/store/clientState.ts";
import { resolveCurrentGameRoomState } from "../../src/features/game-room/currentRoom.ts";
import { createGameRoomApi } from "../../src/features/game-room/gameRoomApi.ts";
import { createInvitationApi } from "../../src/features/invitation/invitationApi.ts";
import { getRoomSocketEligibility } from "../../src/features/realtime/roomSocketLifecycle.ts";
import { deriveMainPageAiChatView } from "../../src/pages/MainPage/aiChatInitialization.ts";
import {
  deriveMainPageInitializationView,
  isMainPageRoomContextStatus,
  loadCurrentRoomState,
  loadInvitations,
  resolveCurrentRoomAfterHttpHydration,
  resolveMainPageDisplayCurrentRoom,
  resolveMainPageRoomContextRoom,
  resolveMainPageVisibleInvitations,
  resolveMainPageWaitingRoomCurrentRoom,
  shouldPreserveCurrentRoomOnEmptyHttpHydration,
} from "../../src/pages/MainPage/mainInitialization.ts";
import { AppError } from "../../src/shared/utils/appError.ts";

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

function createInvitation(overrides = {}) {
  return {
    participantId: "participant-1",
    gameRoomId: "room-1",
    userId: "user-1",
    nickname: "현하",
    role: "OWNER",
    membershipStatus: "INVITED",
    roomStatus: "WAITING",
    createdAt: "2026-05-25T10:06:00Z",
    ...overrides,
  };
}

test("resolveCurrentGameRoomState returns no room when the server returns an empty list", () => {
  assert.deepEqual(resolveCurrentGameRoomState([]), {
    currentRoom: null,
    duplicateRoomWarning: false,
  });
});

test("resolveCurrentGameRoomState returns the only room without a duplicate warning", () => {
  const room = createRoom();

  assert.deepEqual(resolveCurrentGameRoomState([room]), {
    currentRoom: room,
    duplicateRoomWarning: false,
  });
});

test("isMainPageRoomContextStatus includes WAITING and IN_PROGRESS only", () => {
  assert.equal(isMainPageRoomContextStatus("WAITING"), true);
  assert.equal(isMainPageRoomContextStatus("IN_PROGRESS"), true);
  assert.equal(isMainPageRoomContextStatus("JUDGING"), false);
});

test("resolveMainPageRoomContextRoom returns IN_PROGRESS joined rooms for waiting-room derivation", () => {
  const room = createRoom({ status: "IN_PROGRESS" });

  assert.deepEqual(resolveMainPageRoomContextRoom(room), room);
  assert.equal(resolveMainPageRoomContextRoom(createRoom({ status: "JUDGING" })), null);
});

test("resolveCurrentGameRoomState keeps IN_PROGRESS rooms as the current room", () => {
  const room = createRoom({ status: "IN_PROGRESS" });

  assert.deepEqual(resolveCurrentGameRoomState([room]), {
    currentRoom: room,
    duplicateRoomWarning: false,
  });
});

test("resolveCurrentGameRoomState ignores finished rooms when selecting the current room", () => {
  const finishedRoom = createRoom({
    gameRoomId: "room-finished",
    status: "FINISHED",
  });

  assert.deepEqual(resolveCurrentGameRoomState([finishedRoom]), {
    currentRoom: null,
    duplicateRoomWarning: false,
  });
});

test("resolveCurrentGameRoomState ignores invited rooms when selecting the current room", () => {
  const invitedRoom = createRoom({
    gameRoomId: "room-invited",
    myMembershipStatus: "INVITED",
  });

  assert.deepEqual(resolveCurrentGameRoomState([invitedRoom]), {
    currentRoom: null,
    duplicateRoomWarning: false,
  });
});

test("resolveCurrentGameRoomState prefers the most recently updated room and raises a warning for duplicate rooms", () => {
  const olderRoom = createRoom({
    gameRoomId: "room-older",
    updatedAt: "2026-05-25T10:00:00Z",
  });
  const newerRoom = createRoom({
    gameRoomId: "room-newer",
    updatedAt: "2026-05-25T10:09:00Z",
  });

  let warnedRooms = [];

  const result = resolveCurrentGameRoomState([olderRoom, newerRoom], {
    onDuplicateRoomsDetected(rooms) {
      warnedRooms = rooms;
    },
  });

  assert.equal(result.currentRoom?.gameRoomId, "room-newer");
  assert.equal(result.duplicateRoomWarning, true);
  assert.deepEqual(
    warnedRooms.map((room) => room.gameRoomId),
    ["room-newer", "room-older"],
  );
});

test("createGameRoomApi requests the current-room query by user ID", async () => {
  const calls = [];
  const api = createGameRoomApi({
    async get(path, options) {
      calls.push({ path, options });
      return [createRoom()];
    },
    async post() {
      throw new Error("startGame should not be called in this test");
    },
  });

  const result = await api.getCurrentRooms("user 1");

  assert.equal(result.length, 1);
  assert.deepEqual(calls, [
    {
      path: "/game-rooms?userId=user%201",
      options: undefined,
    },
  ]);
});

test("createGameRoomApi normalizes backend current-room payloads that use id", async () => {
  const api = createGameRoomApi({
    async get() {
      return [
        {
          id: "room-1",
          status: "WAITING",
          ownerUserId: "user-1",
          minParticipants: 2,
          maxParticipants: 4,
          createdAt: "2026-05-25T10:00:00Z",
          updatedAt: "2026-05-25T10:05:00Z",
        },
      ];
    },
    async post() {
      throw new Error("startGame should not be called in this test");
    },
  });

  const [room] = await api.getCurrentRooms("user-1");

  assert.deepEqual(room, {
    gameRoomId: "room-1",
    status: "WAITING",
    difficulty: "NORMAL",
    ownerUserId: "user-1",
    myRole: "OWNER",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 1,
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: "2026-05-25T10:00:00Z",
    updatedAt: "2026-05-25T10:05:00Z",
  });
});

test("createGameRoomApi posts the start-game request with a required missionTemplateId body", async () => {
  const calls = [];
  const api = createGameRoomApi({
    async get() {
      throw new Error("getCurrentRooms should not be called in this test");
    },
    async post(path, body, options) {
      calls.push({ path, body, options });
      return { success: true };
    },
  });

  const result = await api.startGame("room 1", {
    missionTemplateId: "template-1",
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, [
    {
      path: "/game-rooms/room%201/start",
      body: {
        missionTemplateId: "template-1",
      },
      options: undefined,
    },
  ]);
});

test("createGameRoomApi passes missionTemplateId through to the start-game request", async () => {
  const calls = [];
  const api = createGameRoomApi({
    async get() {
      throw new Error("getCurrentRooms should not be called in this test");
    },
    async post(path, body, options) {
      calls.push({ path, body, options });
      return { success: true };
    },
  });

  await api.startGame("room 1", {
    missionTemplateId: "template-1",
  });

  assert.deepEqual(calls, [
    {
      path: "/game-rooms/room%201/start",
      body: {
        missionTemplateId: "template-1",
      },
      options: undefined,
    },
  ]);
});

test("createInvitationApi requests only invited participants for the signed-in user", async () => {
  const calls = [];
  const api = createInvitationApi({
    async get(path, options) {
      calls.push({ path, options });
      return [createInvitation({ userId: "user 1" })];
    },
  });

  const result = await api.getInvitedParticipants("user 1");

  assert.equal(result.length, 1);
  assert.deepEqual(calls, [
    {
      path: "/game-room-participants?userId=user%201&membershipStatus=INVITED",
      options: undefined,
    },
  ]);
});

test("createInvitationApi keeps only the signed-in user's invited rows and normalizes backend membershipStatus", async () => {
  const api = createInvitationApi({
    async get() {
      return [
        {
          participantId: "participant-1",
          gameRoomId: "room-1",
          title: "릴레이 방",
          userId: "user-1",
          nickname: "현하",
          role: "PARTICIPANT",
          membershipStatus: "INVITED",
          roomStatus: "WAITING",
          createdAt: "2026-05-25T10:06:00Z",
        },
        {
          participantId: "participant-2",
          gameRoomId: "room-1",
          title: "릴레이 방",
          userId: "other-user",
          nickname: "민수",
          role: "PARTICIPANT",
          membershipStatus: "INVITED",
          roomStatus: "WAITING",
          createdAt: "2026-05-25T10:06:00Z",
        },
        {
          participantId: "participant-3",
          gameRoomId: "room-1",
          title: "릴레이 방",
          userId: "user-1",
          nickname: "현하",
          role: "PARTICIPANT",
          membershipStatus: "JOINED",
          roomStatus: "WAITING",
          createdAt: "2026-05-25T10:06:00Z",
        },
      ];
    },
  });

  const result = await api.getInvitedParticipants("user-1");

  assert.deepEqual(result, [
    {
      participantId: "participant-1",
      gameRoomId: "room-1",
      userId: "user-1",
      nickname: "현하",
      role: "PARTICIPANT",
      membershipStatus: "INVITED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T10:06:00Z",
    },
  ]);
});

test("createInvitationApi accepts backend invitation rows that use id instead of participantId", async () => {
  const api = createInvitationApi({
    async get() {
      return [
        {
          id: "participant-1",
          gameRoomId: "room-1",
          userId: "user-1",
          membershipStatus: "INVITED",
          role: "PARTICIPANT",
          createdAt: "2026-05-25T10:06:00Z",
        },
      ];
    },
  });

  const result = await api.getInvitedParticipants("user-1");

  assert.deepEqual(result, [
    {
      participantId: "participant-1",
      gameRoomId: "room-1",
      userId: "user-1",
      nickname: "알 수 없는 사용자",
      role: "PARTICIPANT",
      membershipStatus: "INVITED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T10:06:00Z",
    },
  ]);
});

test("createInvitationApi keeps invitation row nickname without inferring an inviter", async () => {
  const api = createInvitationApi({
    async get() {
      return [
        {
          id: "participant-owner",
          gameRoomId: "room-1",
          userId: "owner-1",
          nickname: "방장민수",
          role: "OWNER",
          membershipStatus: "JOINED",
          roomStatus: "WAITING",
          createdAt: "2026-05-25T10:05:00Z",
        },
        {
          id: "participant-invitee",
          gameRoomId: "room-1",
          userId: "user-1",
          nickname: "현하",
          role: "PARTICIPANT",
          membershipStatus: "INVITED",
          roomStatus: "WAITING",
          createdAt: "2026-05-25T10:06:00Z",
        },
      ];
    },
  });

  const result = await api.getInvitedParticipants("user-1");

  assert.deepEqual(result, [
    {
      participantId: "participant-invitee",
      gameRoomId: "room-1",
      userId: "user-1",
      nickname: "현하",
      role: "PARTICIPANT",
      membershipStatus: "INVITED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T10:06:00Z",
    },
  ]);
});

test("loadCurrentRoomState hydrates the resolved single-room policy", async () => {
  const room = createRoom();

  const result = await loadCurrentRoomState({
    userId: "user-1",
    async getCurrentRooms(userId) {
      assert.equal(userId, "user-1");
      return [room];
    },
  });

  assert.deepEqual(result, {
    currentRoom: room,
    duplicateRoomWarning: false,
  });
});

test("loadInvitations hydrates invited participants for the signed-in user", async () => {
  const invitation = createInvitation();

  const result = await loadInvitations({
    userId: "user-1",
    async getInvitedParticipants(userId) {
      assert.equal(userId, "user-1");
      return [invitation];
    },
  });

  assert.deepEqual(result, [invitation]);
});

test("deriveMainPageInitializationView returns a loading state while both queries are unresolved", () => {
  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: undefined,
      error: null,
      isPending: true,
    },
    invitationQuery: {
      data: undefined,
      error: null,
      isPending: true,
    },
  });

  assert.equal(view.status, "loading");
  assert.equal(view.blockingErrorMessage, null);
});

test("deriveMainPageInitializationView returns the empty ready state when both queries succeed with no room and no invitations", () => {
  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: {
        currentRoom: null,
        duplicateRoomWarning: false,
      },
      error: null,
      isPending: false,
    },
    invitationQuery: {
      data: [],
      error: null,
      isPending: false,
    },
  });

  assert.equal(view.status, "ready");
  assert.equal(view.currentRoomState.currentRoom, null);
  assert.deepEqual(view.invitations, []);
  assert.equal(view.currentRoomErrorMessage, null);
  assert.equal(view.invitationErrorMessage, null);
});

test("deriveMainPageInitializationView keeps a successful current-room result visible when invitation loading fails", () => {
  const room = createRoom();

  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: {
        currentRoom: room,
        duplicateRoomWarning: false,
      },
      error: null,
      isPending: false,
    },
    invitationQuery: {
      data: undefined,
      error: new AppError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Invitation query failed",
        status: 500,
      }),
      isPending: false,
    },
  });

  assert.equal(view.status, "ready");
  assert.equal(view.currentRoomState.currentRoom?.gameRoomId, "room-1");
  assert.equal(view.invitationErrorMessage, null);
});

test("deriveMainPageInitializationView prioritizes invitation cards over inferred non-owner current rooms", () => {
  const room = createRoom({
    gameRoomId: "room-1",
    myRole: "PARTICIPANT",
  });
  const invitation = createInvitation({
    gameRoomId: "room-1",
    userId: "user-1",
    role: "PARTICIPANT",
  });

  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: {
        currentRoom: room,
        duplicateRoomWarning: false,
      },
      error: null,
      isPending: false,
    },
    invitationQuery: {
      data: [invitation],
      error: null,
      isPending: false,
    },
  });

  assert.equal(view.currentRoomState.currentRoom, null);
  assert.deepEqual(view.invitations, [invitation]);
});

test("deriveMainPageInitializationView hides invitations when an IN_PROGRESS current room exists", () => {
  const room = createRoom({ status: "IN_PROGRESS" });
  const invitation = createInvitation();

  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: {
        currentRoom: room,
        duplicateRoomWarning: false,
      },
      error: null,
      isPending: false,
    },
    invitationQuery: {
      data: [invitation],
      error: null,
      isPending: false,
    },
  });

  assert.equal(view.status, "ready");
  assert.equal(view.currentRoomState.currentRoom?.status, "IN_PROGRESS");
  assert.deepEqual(view.invitations, []);
});

test("deriveMainPageInitializationView hides invitations when a current room exists", () => {
  const room = createRoom();
  const invitation = createInvitation();

  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: {
        currentRoom: room,
        duplicateRoomWarning: false,
      },
      error: null,
      isPending: false,
    },
    invitationQuery: {
      data: [invitation],
      error: null,
      isPending: false,
    },
  });

  assert.equal(view.status, "ready");
  assert.equal(view.currentRoomState.currentRoom?.gameRoomId, "room-1");
  assert.deepEqual(view.invitations, []);
});

test("deriveMainPageInitializationView returns a retryable blocking error when neither query has usable data", () => {
  const view = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: undefined,
      error: new AppError({
        code: "ROOM_NOT_FOUND",
        message: "No room",
        status: 404,
      }),
      isPending: false,
    },
    invitationQuery: {
      data: undefined,
      error: null,
      isPending: false,
    },
  });

  assert.equal(view.status, "error");
  assert.equal(view.blockingErrorMessage, "The room was not found.");
});

test("resolveCurrentRoomAfterHttpHydration preserves active realtime room when http current room is null", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS", joinedParticipantCount: 2 });

  const preserved = resolveCurrentRoomAfterHttpHydration(null, {
    room: { currentRoom: storeRoom },
    realtime: {
      activeRoomId: "room-1",
      participants: [
        {
          userId: "owner-1",
          nickname: "방장",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 0,
        maxStrikeCount: 3,
      },
      missionState: { missionId: "mission-1" },
    },
  });

  assert.equal(preserved?.gameRoomId, "room-1");
  assert.equal(preserved?.status, "IN_PROGRESS");
});

test("resolveCurrentRoomAfterHttpHydration clears finished rooms when http current room is null", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS", joinedParticipantCount: 2 });

  const preserved = resolveCurrentRoomAfterHttpHydration(null, {
    room: { currentRoom: storeRoom },
    realtime: {
      activeRoomId: "room-1",
      participants: [
        {
          userId: "owner-1",
          nickname: "방장",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
    game: {
      gameState: {
        status: "FINISHED",
        strikeCount: 1,
        maxStrikeCount: 3,
      },
      missionState: { missionId: "mission-1" },
    },
  });

  assert.equal(preserved, null);
});

test("resolveCurrentRoomAfterHttpHydration clears room when http is null and realtime session is inactive", () => {
  assert.equal(
    resolveCurrentRoomAfterHttpHydration(null, {
      room: { currentRoom: createRoom() },
      realtime: { activeRoomId: null, participants: [] },
      game: { gameState: null, missionState: null },
    }),
    null,
  );
});

test("resolveMainPageWaitingRoomCurrentRoom keeps waiting context when http room is missing", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS", joinedParticipantCount: 2 });

  const waitingRoom = resolveMainPageWaitingRoomCurrentRoom({
    httpRoom: null,
    storeCurrentRoom: storeRoom,
    activeRoomId: "room-1",
    gameState: { status: "IN_PROGRESS", strikeCount: 0, maxStrikeCount: 3 },
    missionState: { missionId: "mission-1" },
    participants: [
      {
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
  });

  assert.equal(waitingRoom?.gameRoomId, "room-1");
  assert.equal(waitingRoom?.status, "IN_PROGRESS");
});

test("resolveMainPageDisplayCurrentRoom keeps room-present ready state when http room is null", () => {
  const waitingRoom = createRoom({ status: "IN_PROGRESS", joinedParticipantCount: 2 });

  const displayCurrentRoom = resolveMainPageDisplayCurrentRoom({
    httpCurrentRoom: null,
    waitingRoomCurrentRoom: waitingRoom,
  });

  assert.equal(displayCurrentRoom?.gameRoomId, "room-1");
  assert.equal(displayCurrentRoom?.status, "IN_PROGRESS");
});

test("main page ready inputs hide invitations and empty prompt when realtime room is preserved", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS", joinedParticipantCount: 2 });
  const waitingRoomCurrentRoom = resolveMainPageWaitingRoomCurrentRoom({
    httpRoom: null,
    storeCurrentRoom: storeRoom,
    activeRoomId: "room-1",
    gameState: { status: "IN_PROGRESS", strikeCount: 0, maxStrikeCount: 3 },
    missionState: { missionId: "mission-1" },
    participants: [
      {
        userId: "owner-1",
        nickname: "방장",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
  });
  const displayCurrentRoom = resolveMainPageDisplayCurrentRoom({
    httpCurrentRoom: null,
    waitingRoomCurrentRoom,
  });
  const visibleInvitations = resolveMainPageVisibleInvitations({
    displayCurrentRoom,
    invitations: [createInvitation()],
  });
  const aiChatView = deriveMainPageAiChatView({
    currentRoom: displayCurrentRoom,
    invitations: visibleInvitations,
    sessionQuery: { data: [], error: null, isPending: false },
    messageQuery: { data: [], error: null, isPending: false },
  });

  assert.equal(Boolean(displayCurrentRoom), true);
  assert.equal(visibleInvitations.length, 0);
  assert.equal(aiChatView.shouldShowEmptyPrompt, false);
});

test("resolveMainPageWaitingRoomCurrentRoom does not revive a stored room when an invitation for that room should be shown", () => {
  const invitation = createInvitation({
    gameRoomId: "room-1",
    userId: "user-1",
    role: "PARTICIPANT",
  });
  const waitingRoomCurrentRoom = resolveMainPageWaitingRoomCurrentRoom({
    httpRoom: null,
    storeCurrentRoom: createRoom({
      gameRoomId: "room-1",
      myRole: "PARTICIPANT",
    }),
    activeRoomId: "room-1",
    gameState: null,
    missionState: null,
    participants: [],
    invitations: [invitation],
  });
  const displayCurrentRoom = resolveMainPageDisplayCurrentRoom({
    httpCurrentRoom: null,
    waitingRoomCurrentRoom,
  });
  const visibleInvitations = resolveMainPageVisibleInvitations({
    displayCurrentRoom,
    invitations: [invitation],
  });

  assert.equal(waitingRoomCurrentRoom, null);
  assert.deepEqual(visibleInvitations, [invitation]);
});

test("shouldPreserveCurrentRoomOnEmptyHttpHydration and waiting-room route keep socket eligibility", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS" });
  const context = {
    room: { currentRoom: storeRoom },
    realtime: {
      activeRoomId: "room-1",
      participants: [
        {
          userId: "owner-1",
          nickname: "방장",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
    game: {
      gameState: { status: "IN_PROGRESS" },
      missionState: null,
    },
  };

  assert.equal(shouldPreserveCurrentRoomOnEmptyHttpHydration(context), true);

  const waitingRoom = resolveMainPageWaitingRoomCurrentRoom({
    httpRoom: null,
    storeCurrentRoom: storeRoom,
    activeRoomId: context.realtime.activeRoomId,
    gameState: context.game.gameState,
    missionState: context.game.missionState,
    participants: context.realtime.participants,
  });

  assert.equal(
    getRoomSocketEligibility({
      accessToken: "access-token",
      currentRoom: resolveCurrentRoomAfterHttpHydration(null, context),
      routeGameRoomId: waitingRoom?.gameRoomId,
      socketUrl: "http://localhost:8080",
      userId: "owner-1",
    }).canConnect,
    true,
  );
});

test("shouldPreserveCurrentRoomOnEmptyHttpHydration returns false for finished game state", () => {
  const storeRoom = createRoom({ status: "IN_PROGRESS" });

  assert.equal(
    shouldPreserveCurrentRoomOnEmptyHttpHydration({
      room: { currentRoom: storeRoom },
      realtime: {
        activeRoomId: "room-1",
        participants: [
          {
            userId: "owner-1",
            nickname: "방장",
            role: "OWNER",
            membershipStatus: "JOINED",
          },
        ],
      },
      game: {
        gameState: { status: "FINISHED", strikeCount: 1, maxStrikeCount: 3 },
        missionState: null,
      },
    }),
    false,
  );
});

test("resetAppStoreForLogout clears room initialization data alongside auth state", () => {
  const store = createAppStore();

  store.setState((state) => ({
    ...state,
    auth: {
      user: {
        userId: "user-1",
        loginId: "relay-user",
        nickname: "현하",
        email: null,
      },
      accessToken: "access-token",
      refreshToken: "refresh-token",
      isAuthenticated: true,
    },
    room: {
      currentRoom: createRoom(),
      duplicateRoomWarning: true,
      invitations: [createInvitation()],
      roomWaitingState: null,
    },
  }));

  resetAppStoreForLogout(store);

  const nextState = store.getState();

  assert.equal(nextState.auth.isAuthenticated, false);
  assert.equal(nextState.room.currentRoom, null);
  assert.equal(nextState.room.duplicateRoomWarning, false);
  assert.deepEqual(nextState.room.invitations, []);
});
