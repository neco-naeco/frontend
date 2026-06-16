import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../../src/app/store/clientState.ts";
import {
  createRoomSocketLifecycleController,
  createRoomSocketLifecycleInput,
  createStoreBackedRoomSocketLifecycleController,
  formatRealtimeCloseMessage,
  getRealtimeCloseBannerCopy,
  getRoomSocketEligibility,
  isRoomSessionUnavailable,
  isSameRoomScopedPath,
  parseSocketDisconnectClose,
  shouldRetainRoomSocketForPath,
} from "../../src/features/realtime/roomSocketLifecycle.ts";

function createRoom(overrides = {}) {
  return {
    gameRoomId: "room-1",
    status: "WAITING",
    difficulty: "NORMAL",
    ownerUserId: "owner-1",
    myRole: "PARTICIPANT",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 2,
    timeLimitSeconds: 30,
    maxStrikeCount: 3,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: "2026-05-25T10:00:00Z",
    updatedAt: "2026-05-25T10:05:00Z",
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    accessToken: "access-token",
    currentRoom: createRoom(),
    routeGameRoomId: "room-1",
    socketUrl: "http://localhost:8080",
    userId: "user-1",
    ...overrides,
  };
}

function createFakeSocket(id = "socket-1") {
  const handlers = new Map();
  const emitted = [];

  return {
    emitted,
    socket: {
      id,
      connectCalls: 0,
      disconnectCalls: 0,
      connect() {
        this.connectCalls += 1;
      },
      disconnect() {
        this.disconnectCalls += 1;
      },
      emit(eventName, payload) {
        emitted.push({ eventName, payload });
      },
      on(eventName, handler) {
        handlers.set(eventName, handler);
      },
      off(eventName) {
        handlers.delete(eventName);
      },
      trigger(eventName, payload) {
        handlers.get(eventName)?.(payload);
      },
    },
  };
}

test("getRoomSocketEligibility only allows joined waiting or in-progress current rooms", () => {
  assert.equal(getRoomSocketEligibility(createInput()).canConnect, true);
  assert.equal(
    getRoomSocketEligibility(
      createInput({
        currentRoom: createRoom({ status: "IN_PROGRESS" }),
      }),
    ).canConnect,
    true,
  );

  assert.deepEqual(
    getRoomSocketEligibility(
      createInput({
        currentRoom: createRoom({ myMembershipStatus: "INVITED" }),
      }),
    ),
    {
      canConnect: false,
      reason: "not-joined",
    },
  );
  assert.deepEqual(
    getRoomSocketEligibility(
      createInput({
        currentRoom: createRoom({ status: "FINISHED" }),
      }),
    ),
    {
      canConnect: false,
      reason: "unsupported-room-status",
    },
  );
  assert.deepEqual(
    getRoomSocketEligibility(createInput({ routeGameRoomId: "other-room" })),
    {
      canConnect: false,
      reason: "room-mismatch",
    },
  );
});

test("room socket lifecycle connects once and emits join-room after connect", () => {
  const updates = [];
  const fake = createFakeSocket();
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());

  assert.equal(fake.socket.connectCalls, 1);
  assert.equal(updates.at(-1).connectionStatus, "connecting");

  fake.socket.trigger("connect");

  assert.deepEqual(fake.emitted, [
    {
      eventName: "join-room",
      payload: {
        accessToken: "access-token",
        gameRoomId: "room-1",
        userId: "user-1",
      },
    },
  ]);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-1",
    connectionStatus: "connected",
    socketId: "socket-1",
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle reconnects after a transport-only disconnect", () => {
  const updates = [];
  const firstSocket = createFakeSocket("socket-1");
  const secondSocket = createFakeSocket("socket-2");
  const sockets = [firstSocket.socket, secondSocket.socket];
  let factoryCalls = 0;
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  controller.sync(createInput());

  assert.equal(factoryCalls, 1);
  assert.equal(firstSocket.socket.connectCalls, 1);

  firstSocket.socket.trigger("disconnect", "transport close");

  assert.equal(factoryCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-1",
    connectionStatus: "closed",
    socketId: null,
    closeCode: null,
    closeReasonCode: "transport close",
  });

  controller.sync(createInput());

  assert.equal(factoryCalls, 2);
  assert.equal(secondSocket.socket.connectCalls, 1);
  assert.equal(updates.at(-1).connectionStatus, "connecting");

  secondSocket.socket.trigger("connect");

  assert.deepEqual(secondSocket.emitted, [
    {
      eventName: "join-room",
      payload: {
        accessToken: "access-token",
        gameRoomId: "room-1",
        userId: "user-1",
      },
    },
  ]);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-1",
    connectionStatus: "connected",
    socketId: "socket-2",
    closeCode: null,
    closeReasonCode: null,
  });
});

test("isSameRoomScopedPath preserves sockets across same-room route transitions only", () => {
  assert.equal(isSameRoomScopedPath("/rooms/room-1/play", "room-1"), true);
  assert.equal(isSameRoomScopedPath("/rooms/room-1/result", "room-1"), true);
  assert.equal(isSameRoomScopedPath("/rooms/room-2/play", "room-1"), false);
  assert.equal(isSameRoomScopedPath("/main", "room-1"), false);
  assert.equal(isSameRoomScopedPath("/rooms/room-1/play", undefined), false);
});

test("shouldRetainRoomSocketForPath also preserves sockets when /main transitions into gameplay", () => {
  assert.equal(shouldRetainRoomSocketForPath("/main", "room-1"), true);
  assert.equal(shouldRetainRoomSocketForPath("/rooms/room-1/play", "room-1"), true);
  assert.equal(shouldRetainRoomSocketForPath("/login", "room-1"), false);
});

test("store-backed lifecycle binds realtime reducers on connect", () => {
  const store = createAppStore();
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
    },
  }));

  const fake = createFakeSocket();
  const controller = createStoreBackedRoomSocketLifecycleController(store, () => fake.socket);
  controller.sync(createInput());
  fake.socket.trigger("connect");

  fake.socket.trigger("game-started", {
    gameRoomId: "room-1",
    gameState: { status: "IN_PROGRESS" },
    missionState: {
      missionId: "mission-1",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(store.getState().game.gameState.status, "IN_PROGRESS");
});

test("room socket lifecycle cleanup only leaves the expected active room", () => {
  const fakeRoom1 = createFakeSocket("socket-1");
  const fakeRoom2 = createFakeSocket("socket-2");
  const sockets = [fakeRoom1.socket, fakeRoom2.socket];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return sockets.shift();
    },
    onUpdate() {},
  });

  controller.sync(createInput());
  controller.sync(
    createInput({
      currentRoom: createRoom({
        gameRoomId: "room-2",
      }),
      routeGameRoomId: "room-2",
    }),
  );
  controller.leave("room-1");

  assert.equal(fakeRoom1.socket.disconnectCalls, 1);
  assert.equal(fakeRoom2.socket.disconnectCalls, 0);
});

test("room socket lifecycle ignores cleanup without an expected room id", () => {
  const fake = createFakeSocket("socket-1");
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate() {},
  });

  controller.sync(createInput());
  controller.leave(undefined);

  assert.equal(fake.socket.disconnectCalls, 0);
});

test("room socket lifecycle does not wedge after a connect error", () => {
  const fakeFirst = createFakeSocket("socket-1");
  const fakeSecond = createFakeSocket("socket-2");
  const sockets = [fakeFirst.socket, fakeSecond.socket];
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fakeFirst.socket.trigger("connect_error", "temporary failure");
  controller.sync(createInput());

  assert.equal(fakeFirst.socket.connectCalls, 1);
  assert.equal(fakeSecond.socket.connectCalls, 1);
  assert.equal(updates.at(-2).connectionStatus, "error");
  assert.equal(updates.at(-1).connectionStatus, "connecting");
});

test("parseSocketDisconnectClose preserves application close codes and transport reasons", () => {
  assert.deepEqual(parseSocketDisconnectClose("4401: AUTH_TOKEN_INVALID"), {
    closeCode: 4401,
    closeReasonCode: "AUTH_TOKEN_INVALID",
  });
  assert.deepEqual(parseSocketDisconnectClose("4401"), {
    closeCode: 4401,
    closeReasonCode: null,
  });
  assert.deepEqual(parseSocketDisconnectClose(1000), {
    closeCode: 1000,
    closeReasonCode: null,
  });
  assert.deepEqual(parseSocketDisconnectClose("transport close"), {
    closeCode: null,
    closeReasonCode: "transport close",
  });
});

test("room socket lifecycle keeps reflected application close codes terminated without reconnecting", () => {
  for (const reason of [
    "4401: AUTH_TOKEN_INVALID",
    "4403: FORBIDDEN_RESOURCE_ACCESS",
    "4404: GAME_ROOM_NOT_FOUND",
    "4401",
    1000,
    "1000",
  ]) {
    const updates = [];
    const fake = createFakeSocket();
    let factoryCalls = 0;
    const controller = createRoomSocketLifecycleController({
      createSocket() {
        factoryCalls += 1;
        return fake.socket;
      },
      onUpdate(update) {
        updates.push(update);
      },
    });

    controller.sync(createInput());
    fake.socket.trigger("connect");
    fake.socket.trigger("disconnect", reason);

    const expectedClose = parseSocketDisconnectClose(reason);
    assert.deepEqual(
      updates.at(-1),
      {
        activeRoomId: "room-1",
        connectionStatus: "closed",
        socketId: null,
        closeCode: expectedClose.closeCode,
        closeReasonCode: expectedClose.closeReasonCode,
      },
      `disconnect reason ${String(reason)}`,
    );

    controller.sync(createInput());

    assert.equal(factoryCalls, 1, `reason ${String(reason)} must not create a new socket`);
    assert.equal(
      fake.socket.connectCalls,
      1,
      `reason ${String(reason)} must not reconnect`,
    );
    assert.equal(updates.at(-1).connectionStatus, "closed");
  }
});

test("formatRealtimeCloseMessage maps reflected reason codes to user-facing copy", () => {
  assert.equal(
    formatRealtimeCloseMessage({
      closeCode: 4403,
      closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
    }),
    "You do not have permission to access this resource.",
  );
  assert.equal(
    getRealtimeCloseBannerCopy({
      closeCode: 1000,
      closeReasonCode: null,
      connectionStatus: "closed",
    }).description,
    "1000",
  );
});

test("isRoomSessionUnavailable locks room interactions on closed or error states", () => {
  assert.equal(isRoomSessionUnavailable("closed"), true);
  assert.equal(isRoomSessionUnavailable("error"), true);
  assert.equal(isRoomSessionUnavailable("connecting"), false);
  assert.equal(isRoomSessionUnavailable("connected"), false);
});

test("getRoomSocketEligibility reports every blocked connection reason", () => {
  const cases = [
    {
      name: "missing access token",
      input: createInput({ accessToken: null }),
      expected: {
        canConnect: false,
        reason: "missing-auth",
      },
    },
    {
      name: "missing user id",
      input: createInput({ userId: null }),
      expected: {
        canConnect: false,
        reason: "missing-auth",
      },
    },
    {
      name: "missing current room",
      input: createInput({ currentRoom: null }),
      expected: {
        canConnect: false,
        reason: "missing-room",
      },
    },
    {
      name: "route room mismatch",
      input: createInput({ routeGameRoomId: "room-2" }),
      expected: {
        canConnect: false,
        reason: "room-mismatch",
      },
    },
    {
      name: "invited membership",
      input: createInput({
        currentRoom: createRoom({ myMembershipStatus: "INVITED" }),
      }),
      expected: {
        canConnect: false,
        reason: "not-joined",
      },
    },
    {
      name: "left membership",
      input: createInput({
        currentRoom: createRoom({ myMembershipStatus: "LEFT" }),
      }),
      expected: {
        canConnect: false,
        reason: "not-joined",
      },
    },
    {
      name: "finished room",
      input: createInput({
        currentRoom: createRoom({ status: "FINISHED" }),
      }),
      expected: {
        canConnect: false,
        reason: "unsupported-room-status",
      },
    },
    {
      name: "cancelled room",
      input: createInput({
        currentRoom: createRoom({ status: "CANCELLED" }),
      }),
      expected: {
        canConnect: false,
        reason: "unsupported-room-status",
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      getRoomSocketEligibility(testCase.input),
      testCase.expected,
      testCase.name,
    );
  }
});

test("getRoomSocketEligibility builds the reflected join-room payload", () => {
  const eligibility = getRoomSocketEligibility(
    createInput({
      accessToken: "token-for-room-7",
      currentRoom: createRoom({
        gameRoomId: "room-7",
        status: "IN_PROGRESS",
      }),
      routeGameRoomId: "room-7",
      socketUrl: "ws://localhost:9090/realtime",
      userId: "user-7",
    }),
  );

  assert.deepEqual(eligibility, {
    canConnect: true,
    joinRoomEvent: {
      accessToken: "token-for-room-7",
      gameRoomId: "room-7",
      userId: "user-7",
    },
    socketUrl: "ws://localhost:9090/realtime",
  });
});

test("room socket lifecycle maps ineligible sync results to idle or left updates", () => {
  const updates = [];
  const fake = createFakeSocket();
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");

  controller.sync(createInput({ accessToken: null }));

  assert.equal(fake.socket.disconnectCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "left",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });

  controller.sync(
    createInput({
      currentRoom: createRoom({ myMembershipStatus: "INVITED" }),
    }),
  );

  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "idle",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle disconnects stale sockets before joining a new room", () => {
  const updates = [];
  const firstRoomSocket = createFakeSocket("socket-room-1");
  const secondRoomSocket = createFakeSocket("socket-room-2");
  const sockets = [firstRoomSocket.socket, secondRoomSocket.socket];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  firstRoomSocket.socket.trigger("connect");
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );
  secondRoomSocket.socket.trigger("connect");

  assert.equal(firstRoomSocket.socket.disconnectCalls, 1);
  assert.equal(secondRoomSocket.socket.connectCalls, 1);
  assert.deepEqual(secondRoomSocket.emitted, [
    {
      eventName: "join-room",
      payload: {
        accessToken: "access-token",
        gameRoomId: "room-2",
        userId: "user-1",
      },
    },
  ]);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-2",
    connectionStatus: "connected",
    socketId: "socket-room-2",
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle emits only while a socket is active", () => {
  const fake = createFakeSocket();
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate() {},
  });

  assert.equal(
    controller.emit("code-updated", { filePath: "main.py" }),
    false,
  );

  controller.sync(createInput());

  assert.equal(
    controller.emit("code-updated", { filePath: "main.py", content: "print(1)" }),
    true,
  );
  assert.deepEqual(fake.emitted, [
    {
      eventName: "code-updated",
      payload: {
        filePath: "main.py",
        content: "print(1)",
      },
    },
  ]);

  controller.leave("room-1");

  assert.equal(
    controller.emit("code-updated", { filePath: "main.py", content: "print(2)" }),
    false,
  );
});

test("room socket lifecycle ignores late events from released sockets", () => {
  const updates = [];
  const firstSocket = createFakeSocket("socket-1");
  const secondSocket = createFakeSocket("socket-2");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );

  firstSocket.socket.trigger("connect");
  firstSocket.socket.trigger("disconnect", "4403: FORBIDDEN_RESOURCE_ACCESS");
  firstSocket.socket.trigger("connect_error", "late error");

  assert.equal(
    updates.some((update) => update.closeReasonCode === "FORBIDDEN_RESOURCE_ACCESS"),
    false,
  );
  assert.equal(updates.at(-1).activeRoomId, "room-2");
  assert.equal(updates.at(-1).connectionStatus, "connecting");

  secondSocket.socket.trigger("connect");

  assert.equal(updates.at(-1).connectionStatus, "connected");
  assert.equal(updates.at(-1).socketId, "socket-2");
});

test("parseSocketDisconnectClose normalizes mixed close reason formats", () => {
  const cases = [
    {
      reason: "4401/AUTH_TOKEN_INVALID",
      expected: {
        closeCode: 4401,
        closeReasonCode: "AUTH_TOKEN_INVALID",
      },
    },
    {
      reason: "4403 : FORBIDDEN_RESOURCE_ACCESS",
      expected: {
        closeCode: 4403,
        closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
      },
    },
    {
      reason: "  ",
      expected: {
        closeCode: null,
        closeReasonCode: null,
      },
    },
    {
      reason: null,
      expected: {
        closeCode: null,
        closeReasonCode: "socket closed",
      },
    },
    {
      reason: undefined,
      expected: {
        closeCode: null,
        closeReasonCode: "socket closed",
      },
    },
    {
      reason: { toString: () => "custom close" },
      expected: {
        closeCode: null,
        closeReasonCode: "custom close",
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      parseSocketDisconnectClose(testCase.reason),
      testCase.expected,
      String(testCase.reason),
    );
  }
});

test("formatRealtimeCloseMessage prefers mapped reason codes over raw close text", () => {
  const cases = [
    {
      closeCode: 4401,
      closeReasonCode: "AUTH_TOKEN_INVALID",
      expected: "Authentication data is invalid.",
    },
    {
      closeCode: 4404,
      closeReasonCode: "GAME_ROOM_NOT_FOUND",
      expected: "The game room was not found.",
    },
    {
      closeCode: 4403,
      closeReasonCode: "UNKNOWN_POLICY",
      expected: "4403 (UNKNOWN_POLICY)",
    },
    {
      closeCode: null,
      closeReasonCode: "transport close",
      expected: "transport close",
    },
    {
      closeCode: null,
      closeReasonCode: null,
      expected: null,
    },
  ];

  for (const testCase of cases) {
    assert.equal(
      formatRealtimeCloseMessage({
        closeCode: testCase.closeCode,
        closeReasonCode: testCase.closeReasonCode,
      }),
      testCase.expected,
    );
  }
});

test("getRealtimeCloseBannerCopy separates error, intentional, and terminated states", () => {
  const cases = [
    {
      name: "transport error",
      input: {
        closeCode: null,
        closeReasonCode: null,
        connectionStatus: "error",
      },
      expected: {
        title: "실시간 연결에 실패했어요.",
        description: "연결 상태를 확인한 뒤 다시 입장해주세요.",
      },
    },
    {
      name: "intentional close",
      input: {
        closeCode: 1000,
        closeReasonCode: null,
        connectionStatus: "closed",
      },
      expected: {
        title: "실시간 연결이 종료됐어요.",
        description: "1000",
      },
    },
    {
      name: "terminated session",
      input: {
        closeCode: 4404,
        closeReasonCode: "GAME_ROOM_NOT_FOUND",
        connectionStatus: "closed",
      },
      expected: {
        title: "게임 세션을 계속할 수 없어요.",
        description: "The game room was not found.",
      },
    },
    {
      name: "transport close",
      input: {
        closeCode: null,
        closeReasonCode: "transport close",
        connectionStatus: "closed",
      },
      expected: {
        title: "실시간 연결이 종료됐어요.",
        description: "transport close",
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      getRealtimeCloseBannerCopy(testCase.input),
      testCase.expected,
      testCase.name,
    );
  }
});

test("store-backed lifecycle writes every realtime update field", () => {
  const store = createAppStore();
  const fake = createFakeSocket("socket-store");
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => fake.socket,
  );

  controller.sync(createInput());

  assert.deepEqual(
    {
      activeRoomId: store.getState().realtime.activeRoomId,
      closeCode: store.getState().realtime.closeCode,
      closeReasonCode: store.getState().realtime.closeReasonCode,
      connectionStatus: store.getState().realtime.connectionStatus,
      socketId: store.getState().realtime.socketId,
    },
    {
      activeRoomId: "room-1",
      closeCode: null,
      closeReasonCode: null,
      connectionStatus: "connecting",
      socketId: null,
    },
  );

  fake.socket.trigger("connect");

  assert.deepEqual(
    {
      activeRoomId: store.getState().realtime.activeRoomId,
      closeCode: store.getState().realtime.closeCode,
      closeReasonCode: store.getState().realtime.closeReasonCode,
      connectionStatus: store.getState().realtime.connectionStatus,
      socketId: store.getState().realtime.socketId,
    },
    {
      activeRoomId: "room-1",
      closeCode: null,
      closeReasonCode: null,
      connectionStatus: "connected",
      socketId: "socket-store",
    },
  );

  fake.socket.trigger("disconnect", "4403: FORBIDDEN_RESOURCE_ACCESS");

  assert.deepEqual(
    {
      activeRoomId: store.getState().realtime.activeRoomId,
      closeCode: store.getState().realtime.closeCode,
      closeReasonCode: store.getState().realtime.closeReasonCode,
      connectionStatus: store.getState().realtime.connectionStatus,
      socketId: store.getState().realtime.socketId,
    },
    {
      activeRoomId: "room-1",
      closeCode: 4403,
      closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
      connectionStatus: "closed",
      socketId: null,
    },
  );
});

test("room socket lifecycle keeps the same socket for repeated eligible syncs", () => {
  const fake = createFakeSocket("socket-stable");
  let factoryCalls = 0;
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  const firstEligibility = controller.sync(createInput());
  const secondEligibility = controller.sync(createInput());
  const thirdEligibility = controller.sync(createInput());

  assert.equal(factoryCalls, 1);
  assert.equal(fake.socket.connectCalls, 1);
  assert.equal(firstEligibility.canConnect, true);
  assert.equal(secondEligibility.canConnect, true);
  assert.equal(thirdEligibility.canConnect, true);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    activeRoomId: "room-1",
    connectionStatus: "connecting",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle clears terminated latch after switching rooms", () => {
  const firstRoomSocket = createFakeSocket("socket-room-1");
  const secondRoomSocket = createFakeSocket("socket-room-2");
  const thirdRoomSocket = createFakeSocket("socket-room-1b");
  const sockets = [
    firstRoomSocket.socket,
    secondRoomSocket.socket,
    thirdRoomSocket.socket,
  ];
  let factoryCalls = 0;
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  firstRoomSocket.socket.trigger("connect");
  firstRoomSocket.socket.trigger("disconnect", "4403: FORBIDDEN_RESOURCE_ACCESS");

  controller.sync(createInput());

  assert.equal(factoryCalls, 1);
  assert.equal(updates.at(-1).connectionStatus, "closed");
  assert.equal(updates.at(-1).closeReasonCode, "FORBIDDEN_RESOURCE_ACCESS");

  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );
  secondRoomSocket.socket.trigger("connect");

  assert.equal(factoryCalls, 2);
  assert.equal(updates.at(-1).activeRoomId, "room-2");
  assert.equal(updates.at(-1).connectionStatus, "connected");

  controller.sync(createInput());
  thirdRoomSocket.socket.trigger("connect");

  assert.equal(factoryCalls, 3);
  assert.equal(updates.at(-1).activeRoomId, "room-1");
  assert.equal(updates.at(-1).connectionStatus, "connected");
  assert.equal(updates.at(-1).closeCode, null);
  assert.equal(updates.at(-1).closeReasonCode, null);
});

test("room socket lifecycle leave only disconnects matching active room", () => {
  const fake = createFakeSocket("socket-active");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  controller.leave("other-room");

  assert.equal(fake.socket.disconnectCalls, 0);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-1",
    connectionStatus: "connected",
    socketId: "socket-active",
    closeCode: null,
    closeReasonCode: null,
  });

  controller.leave("room-1");

  assert.equal(fake.socket.disconnectCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "left",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle resets close metadata after an expected leave", () => {
  const fake = createFakeSocket("socket-close");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  fake.socket.trigger("disconnect", "transport close");

  assert.deepEqual(updates.at(-1), {
    activeRoomId: "room-1",
    connectionStatus: "closed",
    socketId: null,
    closeCode: null,
    closeReasonCode: "transport close",
  });

  controller.sync(createInput());
  controller.leave("room-1");

  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "left",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("store-backed lifecycle releases room realtime event bindings on room switch", () => {
  const store = createAppStore();
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
    },
  }));

  const firstSocket = createFakeSocket("socket-room-1");
  const secondSocket = createFakeSocket("socket-room-2");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => sockets.shift(),
  );

  controller.sync(createInput());
  firstSocket.socket.trigger("connect");
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );
  secondSocket.socket.trigger("connect");

  firstSocket.socket.trigger("game-started", {
    gameRoomId: "room-1",
    gameState: { status: "IN_PROGRESS" },
    missionState: {
      missionId: "mission-stale",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.notEqual(store.getState().game.missionState?.missionId, "mission-stale");

  secondSocket.socket.trigger("game-started", {
    gameRoomId: "room-2",
    gameState: { status: "IN_PROGRESS" },
    missionState: {
      missionId: "mission-active",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(store.getState().game.missionState.missionId, "mission-active");
});

test("store-backed lifecycle removes realtime bindings after leaving a room", () => {
  const store = createAppStore();
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
    },
  }));

  const fake = createFakeSocket("socket-leave");
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => fake.socket,
  );

  controller.sync(createInput());
  fake.socket.trigger("connect");
  controller.leave("room-1");
  fake.socket.trigger("game-started", {
    gameRoomId: "room-1",
    gameState: { status: "IN_PROGRESS" },
    missionState: {
      missionId: "mission-after-leave",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:12:00Z",
  });

  assert.equal(store.getState().realtime.connectionStatus, "left");
  assert.equal(store.getState().game.missionState, null);
});

test("close banner copy falls back when close payload has no message", () => {
  assert.deepEqual(
    getRealtimeCloseBannerCopy({
      closeCode: null,
      closeReasonCode: null,
      connectionStatus: "closed",
    }),
    {
      title: "실시간 연결이 종료됐어요.",
      description: "게임 세션이 닫혔습니다.",
    },
  );
});

test("close banner copy exposes raw unknown application close reason", () => {
  assert.deepEqual(
    getRealtimeCloseBannerCopy({
      closeCode: 4499,
      closeReasonCode: "CUSTOM_CLOSE",
      connectionStatus: "closed",
    }),
    {
      title: "실시간 연결이 종료됐어요.",
      description: "4499 (CUSTOM_CLOSE)",
    },
  );
});

test("isSameRoomScopedPath rejects prefix-only room id matches", () => {
  assert.equal(isSameRoomScopedPath("/rooms/room-10/play", "room-1"), false);
  assert.equal(isSameRoomScopedPath("/rooms/room-1", "room-1"), false);
  assert.equal(isSameRoomScopedPath("/rooms/room-1-extra/play", "room-1"), false);
});

test("createRoomSocketLifecycleInput injects the default socket url without changing room data", () => {
  const room = createRoom({
    gameRoomId: "room-99",
    status: "IN_PROGRESS",
  });

  const input = createRoomSocketLifecycleInput({
    accessToken: "token-99",
    currentRoom: room,
    routeGameRoomId: "room-99",
    userId: "user-99",
  });

  assert.equal(input.accessToken, "token-99");
  assert.equal(input.currentRoom, room);
  assert.equal(input.routeGameRoomId, "room-99");
  assert.equal(input.userId, "user-99");
  assert.equal(typeof input.socketUrl, "string");
  assert.ok(input.socketUrl.length > 0);
});

test("parseSocketDisconnectClose ignores non-finite numeric close reasons", () => {
  assert.deepEqual(parseSocketDisconnectClose(Number.NaN), {
    closeCode: null,
    closeReasonCode: "NaN",
  });
  assert.deepEqual(parseSocketDisconnectClose(Number.POSITIVE_INFINITY), {
    closeCode: null,
    closeReasonCode: "Infinity",
  });
});

test("parseSocketDisconnectClose keeps compact reason text after a prefixed code", () => {
  assert.deepEqual(parseSocketDisconnectClose("4403:FORBIDDEN_RESOURCE_ACCESS"), {
    closeCode: 4403,
    closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
  });
  assert.deepEqual(parseSocketDisconnectClose("4404/GAME_ROOM_NOT_FOUND"), {
    closeCode: 4404,
    closeReasonCode: "GAME_ROOM_NOT_FOUND",
  });
});

test("formatRealtimeCloseMessage prefers raw reason when no close code is present", () => {
  assert.equal(
    formatRealtimeCloseMessage({
      closeCode: null,
      closeReasonCode: "custom transport reason",
    }),
    "custom transport reason",
  );
});

test("formatRealtimeCloseMessage formats close code when reason is blank", () => {
  assert.equal(
    formatRealtimeCloseMessage({
      closeCode: 4000,
      closeReasonCode: null,
    }),
    "4000",
  );
});

test("getRealtimeCloseBannerCopy maps connection errors before close policy handling", () => {
  const copy = getRealtimeCloseBannerCopy({
    closeCode: 4403,
    closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
    connectionStatus: "error",
  });

  assert.equal(typeof copy.title, "string");
  assert.equal(typeof copy.description, "string");
  assert.notEqual(copy.description, "You do not have permission to access this resource.");
});

test("getRealtimeCloseBannerCopy uses mapped close reason in terminated sessions", () => {
  const copy = getRealtimeCloseBannerCopy({
    closeCode: 4401,
    closeReasonCode: "AUTH_TOKEN_INVALID",
    connectionStatus: "closed",
  });

  assert.equal(copy.description, "Authentication data is invalid.");
  assert.equal(typeof copy.title, "string");
  assert.ok(copy.title.length > 0);
});

test("room socket lifecycle does not emit join-room from a released socket connect", () => {
  const firstSocket = createFakeSocket("socket-1");
  const secondSocket = createFakeSocket("socket-2");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return sockets.shift();
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );

  firstSocket.socket.trigger("connect");

  assert.deepEqual(firstSocket.emitted, []);
  assert.equal(updates.at(-1).activeRoomId, "room-2");

  secondSocket.socket.trigger("connect");

  assert.deepEqual(secondSocket.emitted, [
    {
      eventName: "join-room",
      payload: {
        accessToken: "access-token",
        gameRoomId: "room-2",
        userId: "user-1",
      },
    },
  ]);
});

test("room socket lifecycle does not reconnect a latched terminated room after repeated syncs", () => {
  const fake = createFakeSocket("socket-latched");
  let factoryCalls = 0;
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  fake.socket.trigger("disconnect", "4404: GAME_ROOM_NOT_FOUND");

  controller.sync(createInput());
  controller.sync(createInput());
  controller.sync(createInput());

  assert.equal(factoryCalls, 1);
  assert.equal(fake.socket.connectCalls, 1);
  assert.equal(updates.at(-1).connectionStatus, "closed");
  assert.equal(updates.at(-1).closeReasonCode, "GAME_ROOM_NOT_FOUND");
});

test("room socket lifecycle clears active room when sync becomes missing-room", () => {
  const fake = createFakeSocket("socket-room");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  const eligibility = controller.sync(createInput({ currentRoom: null }));

  assert.deepEqual(eligibility, {
    canConnect: false,
    reason: "missing-room",
  });
  assert.equal(fake.socket.disconnectCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "idle",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle clears active room when sync becomes room-mismatch", () => {
  const fake = createFakeSocket("socket-mismatch");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  const eligibility = controller.sync(createInput({ routeGameRoomId: "room-2" }));

  assert.deepEqual(eligibility, {
    canConnect: false,
    reason: "room-mismatch",
  });
  assert.equal(fake.socket.disconnectCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "idle",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle clears active room when sync becomes unsupported status", () => {
  const fake = createFakeSocket("socket-finished");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  const eligibility = controller.sync(
    createInput({
      currentRoom: createRoom({ status: "FINISHED" }),
    }),
  );

  assert.deepEqual(eligibility, {
    canConnect: false,
    reason: "unsupported-room-status",
  });
  assert.equal(fake.socket.disconnectCalls, 1);
  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "idle",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle ignores disconnects triggered by an expected leave", () => {
  const fake = createFakeSocket("socket-expected-leave");
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");
  controller.leave("room-1");
  fake.socket.trigger("disconnect", "transport close");

  assert.deepEqual(updates.at(-1), {
    activeRoomId: null,
    connectionStatus: "left",
    socketId: null,
    closeCode: null,
    closeReasonCode: null,
  });
});

test("room socket lifecycle can emit multiple gameplay events while connected", () => {
  const fake = createFakeSocket("socket-emit-many");
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      return fake.socket;
    },
    onUpdate() {},
  });

  controller.sync(createInput());
  fake.socket.trigger("connect");

  assert.equal(controller.emit("turn-submit", { turnId: "turn-1" }), true);
  assert.equal(controller.emit("code-updated", { filePath: "main.py" }), true);
  assert.deepEqual(fake.emitted.slice(1), [
    {
      eventName: "turn-submit",
      payload: {
        turnId: "turn-1",
      },
    },
    {
      eventName: "code-updated",
      payload: {
        filePath: "main.py",
      },
    },
  ]);
});

test("store-backed lifecycle updates realtime state on connect error", () => {
  const store = createAppStore();
  const fake = createFakeSocket("socket-error");
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => fake.socket,
  );

  controller.sync(createInput());
  fake.socket.trigger("connect_error", "network failed");

  assert.deepEqual(
    {
      activeRoomId: store.getState().realtime.activeRoomId,
      closeCode: store.getState().realtime.closeCode,
      closeReasonCode: store.getState().realtime.closeReasonCode,
      connectionStatus: store.getState().realtime.connectionStatus,
      socketId: store.getState().realtime.socketId,
    },
    {
      activeRoomId: "room-1",
      closeCode: null,
      closeReasonCode: null,
      connectionStatus: "error",
      socketId: null,
    },
  );
});

test("store-backed lifecycle can reconnect after connect error and apply realtime events", () => {
  const store = createAppStore();
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
    },
  }));
  const firstSocket = createFakeSocket("socket-error");
  const secondSocket = createFakeSocket("socket-recovered");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => sockets.shift(),
  );

  controller.sync(createInput());
  firstSocket.socket.trigger("connect_error", "network failed");
  controller.sync(createInput());
  secondSocket.socket.trigger("connect");
  secondSocket.socket.trigger("game-started", {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
    },
    missionState: {
      missionId: "mission-recovered",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [
          {
            filePath: "main.py",
            language: "python",
            readonly: false,
            content: "print('recovered')\n",
          },
        ],
      },
    },
    uiHints: {
      enterGameScreen: false,
      showMissionGuideModal: false,
    },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(store.getState().realtime.connectionStatus, "connected");
  assert.equal(store.getState().realtime.socketId, "socket-recovered");
  assert.equal(store.getState().game.missionState.missionId, "mission-recovered");
  assert.equal(store.getState().editor.files["main.py"], "print('recovered')\n");
});

test("room socket lifecycle preserves socket url from each eligibility input", () => {
  const socketOptions = [];
  const firstSocket = createFakeSocket("socket-url-1");
  const secondSocket = createFakeSocket("socket-url-2");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const controller = createRoomSocketLifecycleController({
    createSocket(options) {
      socketOptions.push(options);
      return sockets.shift();
    },
    onUpdate() {},
  });

  controller.sync(
    createInput({
      socketUrl: "ws://localhost:1001",
    }),
  );
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
      socketUrl: "ws://localhost:1002",
    }),
  );

  assert.deepEqual(socketOptions, [
    {
      socketUrl: "ws://localhost:1001",
    },
    {
      socketUrl: "ws://localhost:1002",
    },
  ]);
});

test("room socket lifecycle does not recreate a socket just because socket url changes for same room", () => {
  const fake = createFakeSocket("socket-same-room");
  let factoryCalls = 0;
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return fake.socket;
    },
    onUpdate() {},
  });

  controller.sync(createInput({ socketUrl: "ws://localhost:1001" }));
  controller.sync(createInput({ socketUrl: "ws://localhost:1002" }));

  assert.equal(factoryCalls, 1);
  assert.equal(fake.socket.connectCalls, 1);
});

test("room socket lifecycle returns ineligible result without creating a socket", () => {
  let factoryCalls = 0;
  const updates = [];
  const controller = createRoomSocketLifecycleController({
    createSocket() {
      factoryCalls += 1;
      return createFakeSocket().socket;
    },
    onUpdate(update) {
      updates.push(update);
    },
  });

  const result = controller.sync(createInput({ accessToken: null }));

  assert.deepEqual(result, {
    canConnect: false,
    reason: "missing-auth",
  });
  assert.equal(factoryCalls, 0);
  assert.deepEqual(updates, [
    {
      activeRoomId: null,
      connectionStatus: "left",
      socketId: null,
      closeCode: null,
      closeReasonCode: null,
    },
  ]);
});

test("store-backed lifecycle keeps stale socket realtime events from mutating recovered room state", () => {
  const store = createAppStore();
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
    },
  }));
  const firstSocket = createFakeSocket("socket-first");
  const secondSocket = createFakeSocket("socket-second");
  const sockets = [firstSocket.socket, secondSocket.socket];
  const controller = createStoreBackedRoomSocketLifecycleController(
    store,
    () => sockets.shift(),
  );

  controller.sync(createInput());
  firstSocket.socket.trigger("connect");
  controller.sync(
    createInput({
      currentRoom: createRoom({ gameRoomId: "room-2" }),
      routeGameRoomId: "room-2",
    }),
  );
  secondSocket.socket.trigger("connect");
  secondSocket.socket.trigger("game-started", {
    gameRoomId: "room-2",
    gameState: {
      status: "IN_PROGRESS",
    },
    missionState: {
      missionId: "mission-current",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [
          {
            filePath: "main.py",
            language: "python",
            readonly: false,
            content: "print('current')\n",
          },
        ],
      },
    },
    uiHints: {
      enterGameScreen: false,
      showMissionGuideModal: false,
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  firstSocket.socket.trigger("code-updated", {
    gameRoomId: "room-1",
    filePath: "main.py",
    content: "print('stale')\n",
    sessionId: "socket-first",
    occurredAt: "2026-05-25T10:12:00Z",
  });

  assert.equal(store.getState().realtime.activeRoomId, "room-2");
  assert.equal(store.getState().game.missionState.missionId, "mission-current");
  assert.equal(store.getState().editor.files["main.py"], "print('current')\n");
});
