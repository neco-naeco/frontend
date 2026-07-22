/**
 * Focused regression suite for the 2026-05-31 spec-sync contract.
 * Covers close-code policy, gameplay entry gating, content-first code sync, turn progression, and result routing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../../src/app/store/clientState.ts";
import {
  applyCodeUpdated,
  applyGameStarted,
  applyGameStateUpdated,
  applyMissionResult,
  applyTurnChanged,
  applyTurnEvaluated,
} from "../../src/features/realtime/realtimeEventReducers.ts";
import { bindRoomRealtimeEvents } from "../../src/features/realtime/roomRealtimeEvents.ts";
import { setRealtimeNavigateHandler } from "../../src/features/realtime/realtimeNavigation.ts";
import {
  applySocketClosePolicy,
  clearRoomContextAfterTerminatedSession,
  shouldApplySocketClosePolicy,
} from "../../src/features/realtime/applySocketClosePolicy.ts";
import {
  resolveSocketClosePolicyAction,
  shouldLatchTerminatedSocketSession,
} from "../../src/features/realtime/socketClosePolicy.ts";
import { getSocketCloseRouteTarget } from "../../src/app/router/authRouting.ts";
import { createMainPageMockApi } from "../../src/pages/MainPage/mockMode.ts";

function seedInProgressGameplay(store) {
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: {
        gameRoomId: "room-1",
        status: "IN_PROGRESS",
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
      },
    },
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
          remainingTimeSeconds: 30,
          status: "IN_PROGRESS",
        },
      },
      missionState: {
        missionId: "mission-1",
        title: "Mission",
        projectStructure: {
          rootPath: "/workspace",
          entryFilePath: "main.py",
          files: [{ filePath: "main.py", language: "python", readonly: false }],
        },
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: false,
      hintsByStepId: {},
    },
    editor: {
      files: { "main.py": "print(1)" },
      authoritativeFiles: { "main.py": "print(0)" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: { "main.py": "print(0)" },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
      connectionStatus: "connected",
      closeCode: null,
      closeReasonCode: null,
      participants: [],
    },
  }));
}

test("reflected close-code policy maps 4401/4403/4404 and excludes transport-only closes", () => {
  assert.equal(resolveSocketClosePolicyAction(4401, null), "auth-logout");
  assert.equal(
    resolveSocketClosePolicyAction(4403, "FORBIDDEN_RESOURCE_ACCESS"),
    "terminated-session",
  );
  assert.equal(
    resolveSocketClosePolicyAction(4404, "GAME_ROOM_NOT_FOUND"),
    "terminated-session",
  );
  assert.equal(resolveSocketClosePolicyAction(1000, null), "intentional-close");
  assert.equal(
    resolveSocketClosePolicyAction(null, "transport close"),
    null,
  );
  assert.equal(shouldApplySocketClosePolicy({ connectionStatus: "closed", closeCode: 4403, closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS" }), true);
  assert.equal(shouldApplySocketClosePolicy({ connectionStatus: "closed", closeCode: 1000, closeReasonCode: null }), false);
  assert.equal(shouldLatchTerminatedSocketSession(4404, null), true);
  assert.equal(
    getSocketCloseRouteTarget("terminated-session", "/rooms/room-1/play"),
    "/main",
  );
  assert.equal(
    getSocketCloseRouteTarget("intentional-close", "/rooms/room-1/play"),
    null,
  );
});

test("terminated-session close policy clears gameplay slices but keeps close metadata", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);
  store.setState((state) => ({
    ...state,
    realtime: {
      ...state.realtime,
      connectionStatus: "closed",
      closeCode: 4403,
      closeReasonCode: "FORBIDDEN_RESOURCE_ACCESS",
    },
  }));

  applySocketClosePolicy({
    action: "terminated-session",
    activeRoomId: "room-1",
    navigate() {},
    routeTarget: "/main",
    store,
    socketController: { leave() {}, sync() {} },
  });

  const next = store.getState();
  assert.equal(next.realtime.closeCode, 4403);
  assert.equal(next.realtime.closeReasonCode, "FORBIDDEN_RESOURCE_ACCESS");
  assert.equal(next.realtime.connectionStatus, "closed");
  assert.equal(next.game.gameState, null);
  assert.equal(next.game.missionState, null);
  assert.deepEqual(next.editor.files, {});
  assert.deepEqual(next.realtime.participants, []);
});

test("clearRoomContextAfterTerminatedSession matches terminated-session cleanup contract", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);
  store.setState((state) => ({
    ...state,
    realtime: {
      ...state.realtime,
      closeCode: 4404,
      closeReasonCode: "GAME_ROOM_NOT_FOUND",
      connectionStatus: "closed",
    },
  }));

  clearRoomContextAfterTerminatedSession(store);

  const next = store.getState();
  assert.equal(next.realtime.closeCode, 4404);
  assert.equal(next.game.missionResult, null);
  assert.equal(next.room.currentRoom, null);
});

test("gameplay entry routes only on game-started with enterGameScreen, not on game-state-updated", () => {
  const storeWithoutRoute = createAppStore();
  seedInProgressGameplay(storeWithoutRoute);
  const storeWithRoute = createAppStore();
  seedInProgressGameplay(storeWithRoute);
  const navigated = [];
  setRealtimeNavigateHandler((path) => {
    navigated.push(path);
  });

  const withoutRoute = applyGameStarted(storeWithoutRoute.getState(), {
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
  assert.equal(withoutRoute.navigationTarget, null);

  const withRoute = applyGameStarted(storeWithRoute.getState(), {
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
  assert.equal(withRoute.navigationTarget, "/rooms/room-1/play");

  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off() {},
  };
  const store = createAppStore();
  seedInProgressGameplay(store);
  bindRoomRealtimeEvents(socket, store);

  handlers.get("game-state-updated")({
    gameRoomId: "room-1",
    gameState: { status: "FINISHED" },
    missionState: null,
  });

  assert.deepEqual(navigated, []);
  assert.equal(store.getState().game.gameState.status, "FINISHED");
  assert.equal(store.getState().game.missionResult, null);

  setRealtimeNavigateHandler(null);
});

test("start-ready mock HTTP success does not imply gameplay entry (realtime game-started still required)", async () => {
  const api = createMainPageMockApi("start-ready");
  const before = await api.getCurrentRooms();
  const response = await api.startGame("mock-start-ready-room-1");
  const after = await api.getCurrentRooms();

  assert.deepEqual(response, { success: true });
  assert.equal(before[0].status, "WAITING");
  assert.deepEqual(after, before);
});

test("content-first code sync updates authoritative files without losing turn baseline ownership", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);

  const next = applyCodeUpdated(store.getState(), {
    gameRoomId: "room-1",
    userId: "user-2",
    sessionId: "socket-remote",
    filePath: "main.py",
    content: "print('server snapshot')\n",
    occurredAt: "2026-05-25T10:10:08Z",
  });

  assert.equal(next.editor.authoritativeFiles["main.py"], "print('server snapshot')\n");
  assert.equal(next.editor.files["main.py"], "print('server snapshot')\n");
  assert.equal(next.editor.turnBaselineTurnId, "turn-1");
  assert.equal(next.editor.turnBaselineReady, true);
  assert.deepEqual(next.editor.turnBaselineFiles, { "main.py": "print(0)" });
});

test("gameplay contract preserves evaluation ordering from submit feedback to next-turn editability", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      turnSubmissionPending: true,
    },
  }));

  const afterEvaluated = applyTurnEvaluated(store.getState(), {
    gameRoomId: "room-1",
    evaluatedTurn: {
      turnId: "turn-1",
      turnNumber: 1,
      playerUserId: "user-1",
      status: "SUBMITTED",
    },
    evaluationResult: {
      isStepCleared: false,
      judgeStatus: "FAILED",
      strikeCount: 1,
      remainingStrikeCount: 2,
      feedbackMessage: "조건 불일치",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "짝수 조건 누락",
          filePath: "main.py",
          lineNumber: 3,
        },
      ],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(afterEvaluated.game.turnSubmissionPending, true);
  assert.equal(afterEvaluated.game.gameState.turnState.status, "SUBMITTED");
  assert.equal(afterEvaluated.game.lastTurnEvaluation.feedbackMessage, "조건 불일치");
  assert.equal(afterEvaluated.editor.markers[0].message, "짝수 조건 누락");

  const afterTurnChanged = applyTurnChanged(afterEvaluated, {
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });

  assert.equal(afterTurnChanged.game.turnSubmissionPending, false);
  assert.equal(afterTurnChanged.game.lastTurnEvaluation.feedbackMessage, "조건 불일치");
  assert.equal(afterTurnChanged.game.gameState.turnState.turnId, "turn-2");
  assert.equal(afterTurnChanged.game.gameState.turnState.currentPlayerId, "user-2");
  assert.equal(afterTurnChanged.game.gameState.turnState.status, "IN_PROGRESS");
  assert.deepEqual(afterTurnChanged.editor.markers, []);
});

test("result routing is mission-result only; applyGameStateUpdated does not expose a navigation target", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);

  const updated = applyGameStateUpdated(store.getState(), {
    gameRoomId: "room-1",
    gameState: { status: "FINISHED" },
    missionState: null,
  });

  assert.equal(updated.game.gameState.status, "FINISHED");
  assert.equal(updated.game.missionResult, null);

  const result = applyMissionResult(store.getState(), {
    gameRoomId: "room-1",
    gameState: { status: "FINISHED" },
    missionResult: {
      missionId: "mission-1",
      isMissionCleared: true,
      judgeStatus: "PASSED",
      selectedInputs: [],
      expectedOutputs: [],
      actualOutputs: [],
      strikeCount: 0,
      remainingStrikeCount: 3,
      feedbackMessage: "성공",
      detectedIssues: [],
    },
  });

  assert.equal(result.navigationTarget, "/rooms/room-1/result");
  assert.equal(result.state.game.missionResult.judgeStatus, "PASSED");
});

test("bindRoomRealtimeEvents navigates to result only on mission-result", () => {
  const store = createAppStore();
  seedInProgressGameplay(store);
  const navigated = [];
  setRealtimeNavigateHandler((path) => {
    navigated.push(path);
  });

  const handlers = new Map();
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off() {},
  };
  bindRoomRealtimeEvents(socket, store);

  handlers.get("game-state-updated")({
    gameRoomId: "room-1",
    gameState: { status: "FINISHED" },
    missionState: null,
  });
  assert.deepEqual(navigated, []);

  handlers.get("mission-result")({
    gameRoomId: "room-1",
    gameState: { status: "FINISHED" },
    missionResult: {
      missionId: "mission-1",
      isMissionCleared: false,
      judgeStatus: "FAILED",
      selectedInputs: [],
      expectedOutputs: [],
      actualOutputs: [],
      strikeCount: 3,
      remainingStrikeCount: 0,
      feedbackMessage: "미션 실패",
      detectedIssues: [],
    },
  });

  assert.deepEqual(navigated, ["/rooms/room-1/result"]);
  setRealtimeNavigateHandler(null);
});
