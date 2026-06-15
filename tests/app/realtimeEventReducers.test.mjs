import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../../src/app/store/clientState.ts";
import {
  applyCodeUpdated,
  applyGameStarted,
  applyGameStateUpdated,
  applyRoomParticipantsUpdated,
  bootstrapEditorFromMission,
  parseRealtimeEventPayload,
  shouldRetainRoomSocketForPath,
} from "../../src/features/realtime/realtimeEventReducers.ts";
import { bindRoomRealtimeEvents } from "../../src/features/realtime/roomRealtimeEvents.ts";
import { setRealtimeNavigateHandler } from "../../src/features/realtime/realtimeNavigation.ts";

function createRoom(overrides = {}) {
  return {
    gameRoomId: "room-1",
    status: "WAITING",
    difficulty: "NORMAL",
    ownerUserId: "owner-1",
    myRole: "OWNER",
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

function seedStore(store, overrides = {}) {
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: createRoom(),
      roomWaitingState: {
        currentRoom: createRoom(),
        participants: [
          {
            userId: "user-1",
            nickname: "A",
            role: "OWNER",
            membershipStatus: "JOINED",
          },
        ],
        changedParticipant: null,
        gameState: { status: "WAITING" },
        missionState: null,
      },
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
      connectionStatus: "connected",
    },
    ...overrides,
  }));
}

test("shouldRetainRoomSocketForPath keeps sockets on /main and same-room gameplay routes", () => {
  assert.equal(shouldRetainRoomSocketForPath("/main", "room-1"), true);
  assert.equal(shouldRetainRoomSocketForPath("/rooms/room-1/play", "room-1"), true);
  assert.equal(shouldRetainRoomSocketForPath("/rooms/room-1/result", "room-1"), true);
  assert.equal(shouldRetainRoomSocketForPath("/rooms/room-2/play", "room-1"), false);
  assert.equal(shouldRetainRoomSocketForPath("/login", "room-1"), false);
});

test("applyRoomParticipantsUpdated persists participants and included game/mission state", () => {
  const store = createAppStore();
  seedStore(store);

  const event = {
    gameRoomId: "room-1",
    participants: [
      {
        userId: "user-1",
        nickname: "A",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-2",
        nickname: "B",
        role: "PARTICIPANT",
        membershipStatus: "LEFT",
      },
    ],
    changedParticipant: {
      userId: "user-2",
      nickname: "B",
      role: "PARTICIPANT",
      membershipStatus: "LEFT",
    },
    gameState: {
      status: "WAITING",
      difficulty: "HARD",
      timeLimitSeconds: 45,
      maxStrikeCount: 5,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
    occurredAt: "2026-05-25T10:10:00Z",
  };

  store.setState((state) => applyRoomParticipantsUpdated(state, event));
  const next = store.getState();

  assert.deepEqual(next.realtime.participants, event.participants);
  assert.deepEqual(next.game.gameState, event.gameState);
  assert.equal(next.game.missionState, null);
  assert.equal(next.room.currentRoom.joinedParticipantCount, 1);
  assert.equal(next.room.currentRoom.difficulty, "HARD");
  assert.deepEqual(next.room.roomWaitingState.participants, event.participants);
  assert.deepEqual(
    next.room.roomWaitingState.changedParticipant,
    event.changedParticipant,
  );
});

test("applyGameStarted bootstraps gameplay state and only routes when enterGameScreen is true", () => {
  const store = createAppStore();
  seedStore(store);

  const event = {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      strikeCount: 0,
      maxStrikeCount: 3,
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "user-1",
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
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [
          {
            filePath: "main.py",
            language: "python",
            readonly: false,
          },
        ],
      },
    },
    uiHints: {
      enterGameScreen: true,
      showMissionGuideModal: true,
    },
    occurredAt: "2026-05-25T10:10:00Z",
  };

  const withNavigation = applyGameStarted(store.getState(), event);
  assert.equal(withNavigation.navigationTarget, "/rooms/room-1/play");
  assert.equal(withNavigation.state.game.gameState.status, "IN_PROGRESS");
  assert.equal(withNavigation.state.game.showMissionGuideModal, true);
  assert.equal(
    withNavigation.state.editor.activeFilePath,
    "main.py",
  );
  assert.deepEqual(withNavigation.state.editor.files, { "main.py": "" });
  assert.equal(withNavigation.state.editor.turnBaselineTurnId, "turn-1");
  assert.equal(withNavigation.state.editor.turnBaselineReady, false);
  assert.deepEqual(withNavigation.state.editor.turnBaselineFiles, {});
  assert.deepEqual(withNavigation.state.editor.authoritativeFiles, {});

  const withoutNavigation = applyGameStarted(store.getState(), {
    ...event,
    uiHints: {
      enterGameScreen: false,
      showMissionGuideModal: false,
    },
  });
  assert.equal(withoutNavigation.navigationTarget, null);
  assert.equal(withoutNavigation.state.game.showMissionGuideModal, false);
});

test("applyGameStarted preserves broader waiting-room participants for gameplay state handoff", () => {
  const store = createAppStore();
  seedStore(store, {
    room: {
      currentRoom: createRoom(),
      roomWaitingState: {
        currentRoom: createRoom(),
        participants: [
          {
            userId: "owner-1",
            nickname: "방장",
            role: "OWNER",
            membershipStatus: "JOINED",
          },
          {
            userId: "user-2",
            nickname: "플레이어",
            role: "PARTICIPANT",
            membershipStatus: "JOINED",
          },
          {
            userId: "user-3",
            nickname: "초대됨",
            role: "PARTICIPANT",
            membershipStatus: "INVITED",
          },
        ],
        changedParticipant: null,
        gameState: { status: "WAITING" },
        missionState: null,
      },
    },
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: null,
      closeCode: null,
      closeReasonCode: null,
      participants: [
        {
          userId: "owner-1",
          nickname: "방장",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
  });

  const event = {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      minParticipants: 2,
      maxParticipants: 4,
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
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [
          {
            filePath: "main.py",
            language: "python",
            readonly: false,
          },
        ],
      },
    },
    uiHints: {
      enterGameScreen: true,
      showMissionGuideModal: true,
    },
    occurredAt: "2026-05-25T10:10:00Z",
  };

  const result = applyGameStarted(store.getState(), event);

  assert.deepEqual(result.state.realtime.participants, [
    {
      userId: "owner-1",
      nickname: "방장",
      role: "OWNER",
      membershipStatus: "JOINED",
    },
    {
      userId: "user-2",
      nickname: "플레이어",
      role: "PARTICIPANT",
      membershipStatus: "JOINED",
    },
    {
      userId: "user-3",
      nickname: "초대됨",
      role: "PARTICIPANT",
      membershipStatus: "INVITED",
    },
  ]);
  assert.equal(result.state.room.currentRoom.joinedParticipantCount, 2);
  assert.deepEqual(
    result.state.room.roomWaitingState.participants,
    result.state.realtime.participants,
  );
});

test("applyGameStarted seeds authoritative editor content from mission projectStructure files", () => {
  const store = createAppStore();
  seedStore(store);

  const event = {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "user-1",
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
      description: "짝수만 반환하세요",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [
          {
            filePath: "main.py",
            language: "python",
            readonly: false,
            content: "print('starter')\n",
          },
        ],
      },
    },
    uiHints: {
      enterGameScreen: true,
      showMissionGuideModal: true,
    },
    occurredAt: "2026-05-25T10:10:00Z",
  };

  const result = applyGameStarted(store.getState(), event);

  assert.equal(result.state.game.missionState.title, "짝수 찾기");
  assert.equal(result.state.game.missionState.description, "짝수만 반환하세요");
  assert.deepEqual(result.state.editor.files, {
    "main.py": "print('starter')\n",
  });
  assert.deepEqual(result.state.editor.authoritativeFiles, {
    "main.py": "print('starter')\n",
  });
  assert.equal(result.state.editor.turnBaselineTurnId, "turn-1");
  assert.equal(result.state.editor.turnBaselineReady, true);
  assert.deepEqual(result.state.editor.turnBaselineFiles, {
    "main.py": "print('starter')\n",
  });
});

test("applyGameStateUpdated merges partial game and mission state for the active room", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 0,
        maxStrikeCount: 3,
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 20,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Before",
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
    },
  });

  store.setState((state) =>
    applyGameStateUpdated(state, {
      gameRoomId: "room-1",
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 2,
      },
      missionState: {
        missionId: "mission-1",
        title: "After",
      },
    }),
  );

  const next = store.getState();
  assert.equal(next.game.gameState.strikeCount, 2);
  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
  assert.equal(next.game.missionState.title, "After");
  assert.equal(next.room.currentRoom.status, "IN_PROGRESS");
});

test("bindRoomRealtimeEvents routes to play only on game-started with enterGameScreen", () => {
  const store = createAppStore();
  seedStore(store);
  const navigated = [];
  setRealtimeNavigateHandler((path) => {
    navigated.push(path);
  });

  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      handlers.delete(eventName);
    },
  };

  bindRoomRealtimeEvents(socket, store);

  handlers.get("room-participants-updated")({
    gameRoomId: "room-1",
    participants: [],
    changedParticipant: null,
    gameState: { status: "WAITING" },
    missionState: null,
    occurredAt: "2026-05-25T10:00:00Z",
  });
  assert.equal(navigated.length, 0);
  assert.equal(store.getState().game.gameState.status, "WAITING");

  handlers.get("game-started")({
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
    uiHints: { enterGameScreen: true, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.deepEqual(navigated, ["/rooms/room-1/play"]);
  assert.equal(store.getState().game.gameState.status, "IN_PROGRESS");

  handlers.get("game-state-updated")({
    gameRoomId: "room-1",
    gameState: { status: "IN_PROGRESS", strikeCount: 1 },
    missionState: null,
  });

  assert.equal(store.getState().game.gameState.strikeCount, 1);
  assert.equal(navigated.length, 1);

  setRealtimeNavigateHandler(null);
});

test("bootstrapEditorFromMission resets file buffers for a new mission bootstrap", () => {
  const editor = bootstrapEditorFromMission({
    missionId: "mission-1",
    projectStructure: {
      rootPath: "/workspace",
      entryFilePath: "main.py",
      files: [{ filePath: "main.py", language: "python", readonly: false }],
    },
  });

  assert.equal(editor.files["main.py"], "");
  assert.equal(editor.activeFilePath, "main.py");
  assert.deepEqual(editor.markers, []);
  assert.deepEqual(editor.authoritativeFiles, {});
  assert.deepEqual(editor.turnBaselineFiles, {});
  assert.equal(editor.turnBaselineTurnId, null);
  assert.equal(editor.turnBaselineReady, false);
});

test("bootstrapEditorFromMission uses inline mission content as the initial authoritative state", () => {
  const editor = bootstrapEditorFromMission({
    missionId: "mission-1",
    projectStructure: {
      rootPath: "/workspace",
      entryFilePath: "main.py",
      files: [
        {
          filePath: "main.py",
          language: "python",
          readonly: false,
          content: "print('starter')\n",
        },
      ],
    },
  });

  assert.equal(editor.files["main.py"], "print('starter')\n");
  assert.deepEqual(editor.authoritativeFiles, {
    "main.py": "print('starter')\n",
  });
  assert.equal(editor.turnBaselineReady, false);
});

test("shouldRetainRoomSocketForPath rejects missing room ids and prefix-only route matches", () => {
  const cases = [
    {
      pathname: "/main",
      gameRoomId: undefined,
      expected: false,
    },
    {
      pathname: "/rooms/room-10/play",
      gameRoomId: "room-1",
      expected: false,
    },
    {
      pathname: "/rooms/room-1",
      gameRoomId: "room-1",
      expected: false,
    },
    {
      pathname: "/rooms/room-1-extra/play",
      gameRoomId: "room-1",
      expected: false,
    },
    {
      pathname: "/rooms/room-1/play/editor",
      gameRoomId: "room-1",
      expected: true,
    },
  ];

  for (const testCase of cases) {
    assert.equal(
      shouldRetainRoomSocketForPath(testCase.pathname, testCase.gameRoomId),
      testCase.expected,
      `${testCase.pathname} / ${testCase.gameRoomId}`,
    );
  }
});

test("applyRoomParticipantsUpdated ignores events for inactive rooms", () => {
  const store = createAppStore();
  seedStore(store);
  const previous = store.getState();

  const next = applyRoomParticipantsUpdated(previous, {
    gameRoomId: "other-room",
    participants: [
      {
        userId: "user-x",
        nickname: "X",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
    changedParticipant: null,
    gameState: { status: "WAITING" },
    missionState: null,
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(next, previous);
  assert.deepEqual(next.realtime.participants, []);
  assert.equal(next.room.currentRoom.gameRoomId, "room-1");
});

test("applyRoomParticipantsUpdated updates realtime slices even when current room is not hydrated", () => {
  const store = createAppStore();
  seedStore(store, {
    room: {
      currentRoom: null,
      roomWaitingState: null,
    },
  });
  const participants = [
    {
      userId: "user-1",
      nickname: "Alpha",
      role: "OWNER",
      membershipStatus: "JOINED",
    },
  ];
  const gameState = {
    status: "WAITING",
    difficulty: "NORMAL",
  };
  const event = {
    gameRoomId: "room-1",
    participants,
    changedParticipant: participants[0],
    gameState,
    missionState: null,
    occurredAt: "2026-05-25T10:10:00Z",
  };

  const next = applyRoomParticipantsUpdated(store.getState(), event);

  assert.deepEqual(next.realtime.participants, participants);
  assert.deepEqual(next.game.gameState, gameState);
  assert.equal(next.game.missionState, null);
  assert.equal(next.room.currentRoom, null);
  assert.equal(next.room.roomWaitingState, null);
});

test("applyRoomParticipantsUpdated keeps current room count when no joined participants are present", () => {
  const store = createAppStore();
  seedStore(store, {
    room: {
      currentRoom: createRoom({ joinedParticipantCount: 3 }),
      roomWaitingState: {
        currentRoom: createRoom({ joinedParticipantCount: 3 }),
        participants: [],
        changedParticipant: null,
        gameState: { status: "WAITING" },
        missionState: null,
      },
    },
  });
  const next = applyRoomParticipantsUpdated(store.getState(), {
    gameRoomId: "room-1",
    participants: [
      {
        userId: "user-2",
        nickname: "B",
        role: "PARTICIPANT",
        membershipStatus: "LEFT",
      },
    ],
    changedParticipant: {
      userId: "user-2",
      nickname: "B",
      role: "PARTICIPANT",
      membershipStatus: "LEFT",
    },
    gameState: {
      status: "WAITING",
      difficulty: "HARD",
      timeLimitSeconds: 60,
      maxStrikeCount: 5,
      minParticipants: 2,
      maxParticipants: 4,
    },
    missionState: null,
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(next.room.currentRoom.joinedParticipantCount, 3);
  assert.equal(next.room.currentRoom.difficulty, "HARD");
  assert.equal(next.room.currentRoom.timeLimitSeconds, 60);
  assert.equal(next.room.currentRoom.maxStrikeCount, 5);
});

test("applyGameStarted ignores inactive room start events", () => {
  const store = createAppStore();
  seedStore(store);
  const previous = store.getState();

  const result = applyGameStarted(previous, {
    gameRoomId: "other-room",
    gameState: { status: "IN_PROGRESS" },
    missionState: {
      missionId: "mission-other",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: true, showMissionGuideModal: true },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(result.state, previous);
  assert.equal(result.navigationTarget, null);
  assert.equal(result.state.game.gameState, null);
});

test("applyGameStarted uses the first mission file when entry file path is missing", () => {
  const store = createAppStore();
  seedStore(store);
  const result = applyGameStarted(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "user-1",
        startedAt: "2026-05-25T10:10:00Z",
        deadlineAt: "2026-05-25T10:10:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 30,
        status: "IN_PROGRESS",
      },
    },
    missionState: {
      missionId: "mission-no-entry",
      projectStructure: {
        rootPath: "/workspace",
        files: [
          {
            filePath: "src/first.py",
            language: "python",
            readonly: false,
            content: "print('first')",
          },
          {
            filePath: "src/second.py",
            language: "python",
            readonly: false,
            content: "print('second')",
          },
        ],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(result.state.editor.activeFilePath, "src/first.py");
  assert.deepEqual(result.state.editor.files, {
    "src/first.py": "print('first')",
    "src/second.py": "print('second')",
  });
});

test("applyGameStarted handles missions with no project files", () => {
  const store = createAppStore();
  seedStore(store);
  const result = applyGameStarted(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      turnState: {
        turnId: "turn-empty",
        turnNumber: 1,
        currentPlayerId: "user-1",
        startedAt: "2026-05-25T10:10:00Z",
        deadlineAt: "2026-05-25T10:10:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 30,
        status: "IN_PROGRESS",
      },
    },
    missionState: {
      missionId: "mission-empty",
      projectStructure: {
        rootPath: "/workspace",
        files: [],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(result.state.editor.activeFilePath, null);
  assert.deepEqual(result.state.editor.files, {});
  assert.deepEqual(result.state.editor.authoritativeFiles, {});
  assert.equal(result.state.editor.turnBaselineTurnId, "turn-empty");
});

test("applyGameStarted prefers waiting room participants when they are more complete", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: null,
      closeCode: null,
      closeReasonCode: null,
      participants: [
        {
          userId: "owner-1",
          nickname: "Owner",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
    room: {
      currentRoom: createRoom(),
      roomWaitingState: {
        currentRoom: createRoom(),
        participants: [
          {
            userId: "owner-1",
            nickname: "Owner",
            role: "OWNER",
            membershipStatus: "JOINED",
          },
          {
            userId: "user-2",
            nickname: "Partner",
            role: "PARTICIPANT",
            membershipStatus: "JOINED",
          },
        ],
        changedParticipant: null,
        gameState: { status: "WAITING" },
        missionState: null,
      },
    },
  });
  const result = applyGameStarted(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
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
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", language: "python", readonly: false }],
      },
    },
    uiHints: { enterGameScreen: false, showMissionGuideModal: false },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(result.state.realtime.participants.length, 2);
  assert.equal(result.state.room.currentRoom.joinedParticipantCount, 2);
});

test("applyGameStateUpdated ignores inactive room state updates", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 0,
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1", title: "Mission" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });
  const previous = store.getState();

  const next = applyGameStateUpdated(previous, {
    gameRoomId: "other-room",
    gameState: {
      status: "IN_PROGRESS",
      strikeCount: 2,
    },
    missionState: {
      missionId: "mission-other",
      title: "Ignored",
    },
  });

  assert.equal(next, previous);
  assert.equal(next.game.gameState.strikeCount, 0);
  assert.equal(next.game.missionState.title, "Mission");
});

test("applyGameStateUpdated preserves mission state when mission payload is omitted", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 0,
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Original mission",
        currentStepStatus: "IN_PROGRESS",
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      strikeCount: 1,
    },
  });

  assert.equal(next.game.gameState.strikeCount, 1);
  assert.equal(next.game.missionState.title, "Original mission");
  assert.equal(next.game.missionState.currentStepStatus, "IN_PROGRESS");
});

test("applyGameStateUpdated clears mission state when null is reflected", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        strikeCount: 0,
      },
      missionState: {
        missionId: "mission-1",
        title: "Mission",
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
    },
    missionState: null,
  });

  assert.equal(next.game.missionState, null);
});

test("applyGameStateUpdated advances editor turn baseline on new turn id", () => {
  const store = createAppStore();
  seedStore(store, {
    editor: {
      files: { "main.py": "dirty local" },
      authoritativeFiles: { "main.py": "server clean" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: { "main.py": "server clean" },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      turnState: {
        turnId: "turn-2",
        turnNumber: 2,
        currentPlayerId: "user-2",
        startedAt: "2026-05-25T10:11:00Z",
        deadlineAt: "2026-05-25T10:11:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 30,
        status: "IN_PROGRESS",
      },
    },
  });

  assert.equal(next.editor.turnBaselineTurnId, "turn-2");
  assert.equal(next.editor.turnBaselineReady, true);
  assert.deepEqual(next.editor.files, { "main.py": "server clean" });
});

test("applyGameStateUpdated keeps editor baseline stable for same turn updates", () => {
  const store = createAppStore();
  seedStore(store, {
    editor: {
      files: { "main.py": "dirty local" },
      authoritativeFiles: { "main.py": "server clean" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: { "main.py": "server clean" },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      strikeCount: 1,
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "user-1",
        startedAt: "2026-05-25T10:10:00Z",
        deadlineAt: "2026-05-25T10:10:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 12,
        status: "IN_PROGRESS",
      },
    },
  });

  assert.equal(next.editor.turnBaselineTurnId, "turn-1");
  assert.deepEqual(next.editor.files, { "main.py": "dirty local" });
  assert.equal(next.game.gameState.strikeCount, 1);
  assert.equal(next.game.gameState.turnState.remainingTimeSeconds, 12);
});

test("applyCodeUpdated ignores inactive room code events", () => {
  const store = createAppStore();
  seedStore(store, {
    editor: {
      files: { "main.py": "local" },
      authoritativeFiles: { "main.py": "server" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: false,
    },
  });
  const previous = store.getState();

  const next = applyCodeUpdated(previous, {
    gameRoomId: "other-room",
    filePath: "main.py",
    content: "ignored",
    sessionId: "other-session",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next, previous);
  assert.deepEqual(next.editor.files, { "main.py": "local" });
});

test("applyCodeUpdated suppresses same-session echoes", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    editor: {
      files: { "main.py": "local" },
      authoritativeFiles: { "main.py": "server" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: false,
    },
  });
  const previous = store.getState();

  const next = applyCodeUpdated(previous, {
    gameRoomId: "room-1",
    filePath: "main.py",
    content: "echo",
    sessionId: "socket-1",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next, previous);
  assert.deepEqual(next.editor.files, { "main.py": "local" });
});

test("applyCodeUpdated applies authoritative content from another session", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: { "main.py": "local" },
      authoritativeFiles: { "main.py": "server" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: false,
    },
  });

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    filePath: "main.py",
    content: "remote authoritative",
    sessionId: "socket-2",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.deepEqual(next.editor.files, {
    "main.py": "remote authoritative",
  });
  assert.deepEqual(next.editor.authoritativeFiles, {
    "main.py": "remote authoritative",
  });
});

test("applyCodeUpdated returns the same state for payloads without content or applicable delta", () => {
  const store = createAppStore();
  seedStore(store, {
    editor: {
      files: { "main.py": "local" },
      authoritativeFiles: { "main.py": "server" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: false,
    },
  });
  const previous = store.getState();

  const next = applyCodeUpdated(previous, {
    gameRoomId: "room-1",
    filePath: "main.py",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next, previous);
});

test("parseRealtimeEventPayload accepts object payloads and rejects primitives", () => {
  const payload = {
    gameRoomId: "room-1",
    occurredAt: "2026-05-25T10:11:00Z",
  };

  assert.equal(parseRealtimeEventPayload(payload), payload);
  assert.equal(parseRealtimeEventPayload(null), null);
  assert.equal(parseRealtimeEventPayload(undefined), null);
  assert.equal(parseRealtimeEventPayload("text"), null);
  assert.equal(parseRealtimeEventPayload(123), null);
  assert.equal(parseRealtimeEventPayload(false), null);
});

test("applyCodeUpdated applies text range deltas to existing working files", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: {
        "main.py": "print('hello')\n",
      },
      authoritativeFiles: {
        "main.py": "print('hello')\n",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {
        "main.py": "print('hello')\n",
      },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    filePath: "main.py",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: 7,
      rangeEnd: 12,
      insertedText: "world",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.editor.files["main.py"], "print('world')\n");
  assert.equal(next.editor.authoritativeFiles["main.py"], "print('hello')\n");
  assert.equal(next.editor.turnBaselineFiles["main.py"], "print('hello')\n");
});

test("applyCodeUpdated can create a working file from a delta when only authoritative content exists", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: {},
      authoritativeFiles: {
        "main.py": "value = 1\n",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {
        "main.py": "value = 1\n",
      },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    filePath: "main.py",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: 8,
      rangeEnd: 9,
      insertedText: "2",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.deepEqual(next.editor.files, {
    "main.py": "value = 2\n",
  });
  assert.deepEqual(next.editor.authoritativeFiles, {
    "main.py": "value = 1\n",
  });
});

test("applyCodeUpdated clamps text range deltas to the current document length", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: {
        "main.py": "abc",
      },
      authoritativeFiles: {
        "main.py": "abc",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    filePath: "main.py",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: 99,
      rangeEnd: 120,
      insertedText: "!",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.editor.files["main.py"], "abc!");
  assert.equal(next.editor.activeFilePath, "main.py");
});

test("applyCodeUpdated ignores invalid text range deltas without touching editor state", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    editor: {
      files: {
        "main.py": "abc",
      },
      authoritativeFiles: {
        "main.py": "abc",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });
  const previous = store.getState();

  const next = applyCodeUpdated(previous, {
    gameRoomId: "room-1",
    filePath: "main.py",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: "0",
      rangeEnd: 1,
      insertedText: "x",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next, previous);
  assert.equal(next.editor.files["main.py"], "abc");
});

test("applyCodeUpdated applies authoritative content before applying a same event delta", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: {
        "main.py": "local",
      },
      authoritativeFiles: {
        "main.py": "server",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: false,
    },
  });

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    filePath: "main.py",
    content: "print(1)",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: 6,
      rangeEnd: 7,
      insertedText: "2",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.editor.authoritativeFiles["main.py"], "print(1)");
  assert.equal(next.editor.files["main.py"], "print(2)");
  assert.equal(next.editor.turnBaselineFiles["main.py"], "print(1)");
});

test("bootstrapEditorFromMission preserves declared files even when content is missing", () => {
  const editor = bootstrapEditorFromMission({
    missionId: "mission-1",
    title: "Mission",
    projectStructure: {
      entryFilePath: "src/main.py",
      files: [
        {
          filePath: "src/main.py",
          content: "print('ready')\n",
        },
        {
          filePath: "src/empty.py",
        },
        {
          filePath: "README.md",
          content: "# Mission\n",
        },
      ],
    },
  });

  assert.deepEqual(editor.files, {
    "src/main.py": "print('ready')\n",
    "src/empty.py": "",
    "README.md": "# Mission\n",
  });
  assert.deepEqual(editor.authoritativeFiles, {
    "src/main.py": "print('ready')\n",
    "README.md": "# Mission\n",
  });
  assert.equal(editor.activeFilePath, "src/main.py");
  assert.deepEqual(editor.markers, []);
});

test("bootstrapEditorFromMission falls back to the first file when no entry file is provided", () => {
  const editor = bootstrapEditorFromMission({
    missionId: "mission-1",
    title: "Mission",
    projectStructure: {
      files: [
        {
          filePath: "alpha.py",
          content: "alpha\n",
        },
        {
          filePath: "beta.py",
          content: "beta\n",
        },
      ],
    },
  });

  assert.equal(editor.activeFilePath, "alpha.py");
  assert.deepEqual(editor.files, {
    "alpha.py": "alpha\n",
    "beta.py": "beta\n",
  });
});

test("bootstrapEditorFromMission handles missions without project files", () => {
  const editor = bootstrapEditorFromMission({
    missionId: "mission-1",
    title: "Mission",
  });

  assert.deepEqual(editor.files, {});
  assert.deepEqual(editor.authoritativeFiles, {});
  assert.equal(editor.activeFilePath, null);
  assert.equal(editor.turnBaselineReady, false);
});

test("applyRoomParticipantsUpdated leaves room card untouched when current room is different", () => {
  const store = createAppStore();
  seedStore(store, {
    room: {
      currentRoom: createRoom({ gameRoomId: "room-2", difficulty: "EASY" }),
      roomWaitingState: {
        currentRoom: createRoom({ gameRoomId: "room-2", difficulty: "EASY" }),
        participants: [],
        changedParticipant: null,
        gameState: { status: "WAITING" },
        missionState: null,
      },
    },
  });

  const next = applyRoomParticipantsUpdated(store.getState(), {
    gameRoomId: "room-1",
    participants: [
      {
        userId: "user-1",
        nickname: "A",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
    ],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "HARD",
      timeLimitSeconds: 60,
      maxStrikeCount: 5,
    },
    missionState: {
      missionId: "mission-1",
      title: "Updated",
    },
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(next.room.currentRoom.gameRoomId, "room-2");
  assert.equal(next.room.currentRoom.difficulty, "EASY");
  assert.equal(next.room.roomWaitingState.currentRoom.gameRoomId, "room-2");
  assert.equal(next.game.gameState.difficulty, "HARD");
  assert.equal(next.game.missionState.title, "Updated");
  assert.equal(next.realtime.participants.length, 1);
});

test("applyRoomParticipantsUpdated ignores inactive room participant snapshots", () => {
  const store = createAppStore();
  seedStore(store);
  const previous = store.getState();

  const next = applyRoomParticipantsUpdated(previous, {
    gameRoomId: "other-room",
    participants: [
      {
        userId: "user-9",
        nickname: "Other",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
    changedParticipant: null,
    gameState: {
      status: "WAITING",
      difficulty: "HARD",
      timeLimitSeconds: 60,
      maxStrikeCount: 5,
    },
    missionState: null,
    occurredAt: "2026-05-25T10:10:00Z",
  });

  assert.equal(next, previous);
  assert.deepEqual(next.realtime.participants, previous.realtime.participants);
  assert.equal(next.room.currentRoom.difficulty, "NORMAL");
});

test("applyGameStateUpdated merges partial game updates without dropping the current turn", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [
        {
          userId: "user-1",
          nickname: "A",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
        {
          userId: "user-2",
          nickname: "B",
          role: "PARTICIPANT",
          membershipStatus: "JOINED",
        },
      ],
    },
    game: {
      gameState: {
        status: "IN_PROGRESS",
        difficulty: "NORMAL",
        timeLimitSeconds: 30,
        maxStrikeCount: 3,
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Before",
        currentStepId: "step-1",
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      remainingTimeSeconds: 12,
    },
    missionState: {
      title: "After",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
  assert.equal(next.game.gameState.remainingTimeSeconds, 12);
  assert.equal(next.game.gameState.timeLimitSeconds, 30);
  assert.equal(next.game.missionState.missionId, "mission-1");
  assert.equal(next.game.missionState.title, "After");
  assert.equal(next.game.missionState.currentStepId, "step-1");
  assert.equal(next.room.currentRoom.joinedParticipantCount, 2);
  assert.equal(next.room.roomWaitingState.gameState.turnState.turnId, "turn-1");
});

test("applyGameStateUpdated clears mission state when the backend sends null", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Before",
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
    },
    missionState: null,
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.missionState, null);
  assert.equal(next.room.roomWaitingState.missionState, null);
  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
});

test("applyGameStateUpdated captures a new turn baseline when the turn id changes", () => {
  const store = createAppStore();
  seedStore(store, {
    game: {
      gameState: {
        status: "IN_PROGRESS",
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: { missionId: "mission-1" },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: {
        "main.py": "working",
      },
      authoritativeFiles: {
        "main.py": "authoritative",
      },
      activeFilePath: "main.py",
      markers: [
        {
          issueType: "LOGIC_ERROR",
          message: "previous marker",
          filePath: "main.py",
          lineNumber: 1,
        },
      ],
      turnBaselineFiles: {
        "main.py": "old",
      },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });

  const next = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "IN_PROGRESS",
      turnState: {
        turnId: "turn-2",
        turnNumber: 2,
        currentPlayerId: "user-2",
        startedAt: "2026-05-25T10:11:00Z",
        deadlineAt: "2026-05-25T10:11:30Z",
        timeLimitSeconds: 30,
        remainingTimeSeconds: 30,
        status: "IN_PROGRESS",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.editor.turnBaselineTurnId, "turn-2");
  assert.deepEqual(next.editor.turnBaselineFiles, {
    "main.py": "authoritative",
  });
  assert.equal(next.editor.turnBaselineReady, true);
});

test("bindRoomRealtimeEvents ignores malformed realtime payloads before they reach reducers", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    editor: {
      files: {
        "main.py": "stable",
      },
      authoritativeFiles: {
        "main.py": "stable",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });
  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      handlers.delete(eventName);
    },
  };

  bindRoomRealtimeEvents(socket, store);

  handlers.get("room-participants-updated")(null);
  handlers.get("game-state-updated")("invalid");
  handlers.get("code-updated")({ gameRoomId: "room-1" });
  handlers.get("game-started")({ uiHints: { enterGameScreen: true } });

  const next = store.getState();
  assert.equal(next.editor.files["main.py"], "stable");
  assert.equal(next.realtime.participants.length, 0);
  assert.equal(next.room.currentRoom.status, "WAITING");
});

test("bindRoomRealtimeEvents forwards valid code updates through the socket handler", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
    editor: {
      files: {
        "main.py": "count = 1\n",
      },
      authoritativeFiles: {
        "main.py": "count = 1\n",
      },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: {},
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
  });
  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      handlers.delete(eventName);
    },
  };

  bindRoomRealtimeEvents(socket, store);

  handlers.get("code-updated")({
    gameRoomId: "room-1",
    filePath: "main.py",
    sessionId: "socket-2",
    codeDelta: {
      rangeStart: 8,
      rangeEnd: 9,
      insertedText: "2",
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(store.getState().editor.files["main.py"], "count = 2\n");
});

test("bindRoomRealtimeEvents navigates to gameplay only when game-started asks for entry", () => {
  const store = createAppStore();
  seedStore(store, {
    realtime: {
      activeRoomId: "room-1",
      connectionStatus: "connected",
      socketId: "socket-1",
      closeCode: null,
      closeReasonCode: null,
      participants: [
        {
          userId: "user-1",
          nickname: "A",
          role: "OWNER",
          membershipStatus: "JOINED",
        },
      ],
    },
  });
  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      handlers.delete(eventName);
    },
  };
  const navigations = [];
  setRealtimeNavigateHandler((target) => {
    navigations.push(target);
  });

  try {
    bindRoomRealtimeEvents(socket, store);

    handlers.get("game-started")({
      gameRoomId: "room-1",
      gameState: {
        status: "IN_PROGRESS",
        difficulty: "NORMAL",
        timeLimitSeconds: 30,
        maxStrikeCount: 3,
        turnState: {
          turnId: "turn-1",
          turnNumber: 1,
          currentPlayerId: "user-1",
          startedAt: "2026-05-25T10:10:00Z",
          deadlineAt: "2026-05-25T10:10:30Z",
          timeLimitSeconds: 30,
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Mission",
        projectStructure: {
          entryFilePath: "main.py",
          files: [
            {
              filePath: "main.py",
              content: "print('hello')\n",
            },
          ],
        },
      },
      uiHints: {
        enterGameScreen: false,
        showMissionGuideModal: true,
      },
      occurredAt: "2026-05-25T10:10:00Z",
    });

    assert.deepEqual(navigations, []);
    assert.equal(store.getState().game.showMissionGuideModal, true);
    assert.equal(store.getState().editor.activeFilePath, "main.py");
  } finally {
    setRealtimeNavigateHandler(null);
  }
});
