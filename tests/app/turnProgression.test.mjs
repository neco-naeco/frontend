import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../../src/app/store/clientState.ts";
import {
  applyMissionResult,
  applyTurnChanged,
  applyTurnEvaluated,
} from "../../src/features/realtime/realtimeEventReducers.ts";
import { bindRoomRealtimeEvents } from "../../src/features/realtime/roomRealtimeEvents.ts";
import { setRealtimeNavigateHandler } from "../../src/features/realtime/realtimeNavigation.ts";
import { promoteSubmittedSnapshotToAuthoritative } from "../../src/features/editor/authoritativeEditorSync.ts";
import { canEditGameplay } from "../../src/pages/RoomPage/roomPageViewModel.ts";

function seedGameplayStore(store) {
  store.setState((state) => ({
    ...state,
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
      },
      showMissionGuideModal: false,
      lastTurnEvaluation: null,
      missionResult: null,
      turnSubmissionPending: true,
      hintsByStepId: {},
    },
    editor: {
      files: { "main.py": "dirty" },
      authoritativeFiles: { "main.py": "clean" },
      activeFilePath: "main.py",
      markers: [],
      turnBaselineFiles: { "main.py": "clean" },
      turnBaselineTurnId: "turn-1",
      turnBaselineReady: true,
    },
    realtime: {
      ...state.realtime,
      activeRoomId: "room-1",
      connectionStatus: "connected",
    },
  }));
}

test("applyTurnEvaluated stores evaluation, markers, and strike counts while keeping submission lock", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const next = applyTurnEvaluated(store.getState(), {
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

  assert.equal(next.game.turnSubmissionPending, true);
  assert.equal(next.game.lastTurnEvaluation.feedbackMessage, "조건 불일치");
  assert.equal(next.game.gameState.strikeCount, 1);
  assert.equal(next.game.gameState.turnState.status, "SUBMITTED");
  assert.equal(next.editor.markers[0].message, "짝수 조건 누락");
});

test("turn-evaluated keeps editor locked for submitter until turn-changed even if turn is still IN_PROGRESS", () => {
  const store = createAppStore();
  seedGameplayStore(store);

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
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(canEditGameplay("user-1", afterEvaluated.game.gameState), false);
  assert.equal(afterEvaluated.game.turnSubmissionPending, true);
  assert.equal(
    canEditGameplay("user-1", afterEvaluated.game.gameState) &&
      !afterEvaluated.game.turnSubmissionPending,
    false,
  );
});

test("applyTurnChanged updates turn state and mission state while preserving the latest evaluation", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    editor: {
      ...state.editor,
      markers: [
        {
          issueType: "LOGIC_ERROR",
          message: "이전 턴 이슈",
          filePath: "main.py",
          lineNumber: 1,
        },
      ],
    },
    game: {
      ...state.game,
      lastTurnEvaluation: {
        isStepCleared: false,
        judgeStatus: "FAILED",
        strikeCount: 1,
        remainingStrikeCount: 2,
        feedbackMessage: "old",
        detectedIssues: [],
        executionSummary: {
          status: "SUCCESS",
          exitCode: 0,
          stdout: "",
          stderr: "",
        },
      },
    },
  }));

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    missionState: {
      missionId: "mission-1",
      title: "Mission step 2",
      gameRoomMissionStepId: "step-2",
    },
    turnState: {
      turnId: "turn-2",
      turnNumber: 2,
      currentPlayerId: "user-2",
      startedAt: "2026-05-25T10:11:05Z",
      deadlineAt: "2026-05-25T10:11:35Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
    nextPlayerId: "user-2",
    turnSnapshotId: "snapshot-1",
  });

  assert.equal(next.game.turnSubmissionPending, false);
  assert.equal(next.game.lastTurnEvaluation.feedbackMessage, "old");
  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.game.missionState.title, "Mission step 2");
  assert.equal(next.editor.turnBaselineTurnId, "turn-2");
  assert.deepEqual(next.editor.files, { "main.py": "clean" });
  assert.deepEqual(next.editor.markers, []);
});

test("applyTurnChanged converges submitter and observer editors to the submitted snapshot", () => {
  const submittedCode = "def main():\n    return 42\n";
  const createClientState = (authoritativeCode) => {
    const store = createAppStore();
    seedGameplayStore(store);
    store.setState((state) => ({
      ...state,
      editor: {
        ...state.editor,
        files: { "main.py": submittedCode },
        authoritativeFiles: { "main.py": authoritativeCode },
        turnBaselineFiles: { "main.py": "clean" },
      },
    }));
    return store.getState();
  };
  const event = {
    gameRoomId: "room-1",
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
            content: submittedCode,
          },
        ],
      },
    },
    turnState: {
      turnId: "turn-2",
      turnNumber: 2,
      currentPlayerId: "user-2",
      startedAt: "2026-05-25T10:11:05Z",
      deadlineAt: "2026-05-25T10:11:35Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
    nextPlayerId: "user-2",
    turnSnapshotId: "snapshot-1",
  };

  const submitter = applyTurnChanged(createClientState("clean"), event);
  const observer = applyTurnChanged(createClientState(submittedCode), event);

  assert.deepEqual(submitter.editor.files, observer.editor.files);
  assert.deepEqual(submitter.editor.authoritativeFiles, observer.editor.authoritativeFiles);
  assert.deepEqual(submitter.editor.turnBaselineFiles, observer.editor.turnBaselineFiles);
  assert.equal(submitter.editor.files["main.py"], submittedCode);
});

test("a submitter keeps submitted code when its turn returns without an inline snapshot", () => {
  const submittedCode = "def main():\n    print(42)\n";
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    editor: {
      ...state.editor,
      files: { "main.py": submittedCode },
      authoritativeFiles: { "main.py": "starter" },
      turnBaselineFiles: { "main.py": "starter" },
    },
  }));

  const submitted = store.getState();
  const afterSubmit = {
    ...submitted,
    editor: promoteSubmittedSnapshotToAuthoritative(
      submitted.editor,
      { files: [{ filePath: "main.py", content: submittedCode }] },
      "turn-1",
    ),
  };
  const turnEvent = (turnId, userId, occurredAt) => ({
    gameRoomId: "room-1",
    currentTurnId: turnId,
    currentTurnUserId: userId,
    occurredAt,
  });
  const afterNextPlayer = applyTurnChanged(
    afterSubmit,
    turnEvent("turn-2", "user-2", "2026-07-21T17:00:00+09:00"),
  );
  const afterTurnReturns = applyTurnChanged(
    afterNextPlayer,
    turnEvent("turn-3", "user-1", "2026-07-21T17:01:00+09:00"),
  );

  assert.equal(afterTurnReturns.editor.files["main.py"], submittedCode);
});

test("a failed turn rolls every client back to the last accepted code", () => {
  const acceptedCode = "print('accepted')\n";
  const failedCode = "not valid python";
  const createFailedClient = () => {
    const store = createAppStore();
    seedGameplayStore(store);
    store.setState((state) => ({
      ...state,
      editor: {
        ...state.editor,
        files: { "main.py": failedCode },
        authoritativeFiles: { "main.py": failedCode },
      },
    }));
    return store.getState();
  };
  const event = {
    gameRoomId: "room-1",
    missionState: {
      missionId: "mission-1",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "main.py",
        files: [{ filePath: "main.py", content: acceptedCode }],
      },
    },
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-07-21T17:00:00+09:00",
  };

  const submitter = applyTurnChanged(createFailedClient(), event);
  const participant = applyTurnChanged(createFailedClient(), event);

  assert.equal(submitter.editor.files["main.py"], acceptedCode);
  assert.equal(participant.editor.files["main.py"], acceptedCode);
  assert.equal(submitter.editor.authoritativeFiles["main.py"], acceptedCode);
  assert.equal(participant.editor.authoritativeFiles["main.py"], acceptedCode);
});

test("applyTurnChanged reconstructs editable next-turn state from backend-first payloads", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      lastTurnEvaluation: {
        isStepCleared: false,
        judgeStatus: "FAILED",
        strikeCount: 1,
        remainingStrikeCount: 2,
        feedbackMessage: "old",
        detectedIssues: [],
        executionSummary: {
          status: "SUCCESS",
          exitCode: 0,
          stdout: "",
          stderr: "",
        },
      },
    },
  }));

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });

  assert.equal(next.game.turnSubmissionPending, false);
  assert.equal(next.game.lastTurnEvaluation.feedbackMessage, "old");
  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.game.gameState.turnState.currentPlayerId, "user-2");
  assert.equal(next.game.gameState.turnState.turnNumber, 2);
  assert.equal(next.game.gameState.turnState.status, "IN_PROGRESS");
  assert.equal(next.game.gameState.turnState.startedAt, "2026-05-25T10:11:05Z");
  assert.equal(next.game.gameState.turnState.deadlineAt, "2026-05-25T10:11:35.000Z");
  assert.equal(canEditGameplay("user-1", next.game.gameState), false);
  assert.equal(canEditGameplay("user-2", next.game.gameState), true);
});

test("applyMissionResult stores final payload and exposes result navigation target", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const result = applyMissionResult(store.getState(), {
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

  assert.equal(result.navigationTarget, "/rooms/room-1/result");
  assert.equal(result.state.game.missionResult.feedbackMessage, "미션 실패");
  assert.equal(result.state.game.gameState.status, "FINISHED");
});

test("bindRoomRealtimeEvents routes to result on mission-result", () => {
  const store = createAppStore();
  seedGameplayStore(store);
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

  handlers.get("mission-result")({
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

  assert.deepEqual(navigated, ["/rooms/room-1/result"]);
  assert.equal(store.getState().game.missionResult.judgeStatus, "PASSED");

  setRealtimeNavigateHandler(null);
});

test("bindRoomRealtimeEvents accepts backend-first turn-changed payloads without turnState", () => {
  const store = createAppStore();
  seedGameplayStore(store);

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

  handlers.get("turn-changed")({
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });

  const next = store.getState();
  assert.equal(next.game.turnSubmissionPending, false);
  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.game.gameState.turnState.currentPlayerId, "user-2");
  assert.equal(next.game.gameState.turnState.status, "IN_PROGRESS");
});

test("applyTurnEvaluated ignores events for inactive rooms", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const next = applyTurnEvaluated(previous, {
    gameRoomId: "other-room",
    evaluatedTurn: {
      turnId: "turn-1",
      turnNumber: 1,
      playerUserId: "user-1",
      status: "SUBMITTED",
    },
    evaluationResult: {
      isStepCleared: false,
      judgeStatus: "FAILED",
      strikeCount: 2,
      remainingStrikeCount: 1,
      feedbackMessage: "ignored",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "ignored issue",
          filePath: "main.py",
          lineNumber: 1,
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

  assert.equal(next, previous);
  assert.equal(next.game.lastTurnEvaluation, null);
  assert.deepEqual(next.editor.markers, []);
});

test("applyTurnEvaluated preserves current turn when evaluated turn id is stale", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const next = applyTurnEvaluated(store.getState(), {
    gameRoomId: "room-1",
    evaluatedTurn: {
      turnId: "old-turn",
      turnNumber: 0,
      playerUserId: "user-9",
      status: "SUBMITTED",
    },
    evaluationResult: {
      isStepCleared: false,
      judgeStatus: "FAILED",
      strikeCount: 2,
      remainingStrikeCount: 1,
      feedbackMessage: "stale evaluation",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
  assert.equal(next.game.gameState.turnState.status, "IN_PROGRESS");
  assert.equal(next.game.lastTurnEvaluation.feedbackMessage, "stale evaluation");
  assert.equal(next.game.gameState.strikeCount, 2);
});

test("applyTurnEvaluated expands max strike count when backend remaining count implies a larger total", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      gameState: {
        ...state.game.gameState,
        maxStrikeCount: 2,
      },
    },
  }));

  const next = applyTurnEvaluated(store.getState(), {
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
      strikeCount: 3,
      remainingStrikeCount: 2,
      feedbackMessage: "larger strike budget",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.strikeCount, 3);
  assert.equal(next.game.gameState.maxStrikeCount, 3);
});

test("applyTurnChanged ignores inactive room turn changes", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const next = applyTurnChanged(previous, {
    gameRoomId: "other-room",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });

  assert.equal(next, previous);
  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
});

test("applyTurnChanged ignores backend-first payloads that cannot build a turn state", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const withoutTurnId = applyTurnChanged(previous, {
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });
  const withoutPlayerId = applyTurnChanged(previous, {
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    occurredAt: "2026-05-25T10:11:05Z",
  });
  const withoutOccurredAt = applyTurnChanged(previous, {
    gameRoomId: "room-1",
    previousTurnId: "turn-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
  });

  assert.equal(withoutTurnId, previous);
  assert.equal(withoutPlayerId, previous);
  assert.equal(withoutOccurredAt, previous);
});

test("applyTurnChanged keeps previous mission state when mission payload is omitted or null", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const withoutMissionPayload = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    turnState: {
      turnId: "turn-2",
      turnNumber: 2,
      currentPlayerId: "user-2",
      startedAt: "2026-05-25T10:11:05Z",
      deadlineAt: "2026-05-25T10:11:35Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
  });

  assert.equal(withoutMissionPayload.game.missionState.missionId, "mission-1");
  assert.equal(withoutMissionPayload.game.missionState.title, "Mission");

  const withNullMissionPayload = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    missionState: null,
    turnState: {
      turnId: "turn-3",
      turnNumber: 3,
      currentPlayerId: "user-3",
      startedAt: "2026-05-25T10:12:05Z",
      deadlineAt: "2026-05-25T10:12:35Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
  });

  assert.equal(withNullMissionPayload.game.missionState.missionId, "mission-1");
  assert.equal(withNullMissionPayload.game.missionState.title, "Mission");
});

test("applyTurnChanged updates waiting-room game state when current room matches", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    room: {
      currentRoom: {
        gameRoomId: "room-1",
        status: "IN_PROGRESS",
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
      },
      roomWaitingState: {
        currentRoom: {
          gameRoomId: "room-1",
          status: "IN_PROGRESS",
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
        },
        participants: [],
        changedParticipant: null,
        gameState: state.game.gameState,
        missionState: state.game.missionState,
      },
    },
  }));

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    missionState: {
      missionId: "mission-1",
      title: "Updated mission",
    },
    turnState: {
      turnId: "turn-2",
      turnNumber: 2,
      currentPlayerId: "user-2",
      startedAt: "2026-05-25T10:11:05Z",
      deadlineAt: "2026-05-25T10:11:35Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
  });

  assert.equal(next.room.roomWaitingState.gameState.turnState.turnId, "turn-2");
  assert.equal(next.room.roomWaitingState.missionState.title, "Updated mission");
  assert.deepEqual(next.editor.markers, []);
  assert.equal(next.game.turnSubmissionPending, false);
});

test("applyMissionResult ignores inactive room results", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const result = applyMissionResult(previous, {
    gameRoomId: "other-room",
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
      feedbackMessage: "ignored result",
      detectedIssues: [],
    },
  });

  assert.equal(result.state, previous);
  assert.equal(result.navigationTarget, null);
  assert.equal(result.state.game.missionResult, null);
});

test("applyMissionResult routes even when final game state is omitted", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const result = applyMissionResult(store.getState(), {
    gameRoomId: "room-1",
    missionResult: {
      missionId: "mission-1",
      isMissionCleared: true,
      judgeStatus: "PASSED",
      selectedInputs: ["1 2"],
      expectedOutputs: ["3"],
      actualOutputs: ["3"],
      strikeCount: 0,
      remainingStrikeCount: 3,
      feedbackMessage: "cleared",
      detectedIssues: [],
    },
  });

  assert.equal(result.navigationTarget, "/rooms/room-1/result");
  assert.equal(result.state.game.missionResult.feedbackMessage, "cleared");
  assert.equal(result.state.game.gameState.status, "IN_PROGRESS");
});

test("bindRoomRealtimeEvents removes handlers through the returned unbind function", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const handlers = new Map();
  const removed = [];
  const socket = {
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      removed.push(eventName);
      handlers.delete(eventName);
    },
  };

  const unbind = bindRoomRealtimeEvents(socket, store);

  assert.equal(handlers.has("turn-evaluated"), true);
  assert.equal(handlers.has("turn-changed"), true);
  assert.equal(handlers.has("mission-result"), true);

  unbind();

  assert.equal(handlers.has("turn-evaluated"), false);
  assert.equal(handlers.has("turn-changed"), false);
  assert.equal(handlers.has("mission-result"), false);
  assert.equal(removed.includes("turn-evaluated"), true);
  assert.equal(removed.includes("turn-changed"), true);
  assert.equal(removed.includes("mission-result"), true);
});

test("applyTurnEvaluated preserves the current turn when backend evaluates an older turn", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      gameState: {
        ...state.game.gameState,
        turnState: {
          ...state.game.gameState.turnState,
          turnId: "turn-2",
          turnNumber: 2,
          currentPlayerId: "user-2",
          status: "IN_PROGRESS",
        },
      },
    },
  }));

  const next = applyTurnEvaluated(store.getState(), {
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
      strikeCount: 2,
      remainingStrikeCount: 1,
      feedbackMessage: "late result",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "old turn issue",
          filePath: "main.py",
          lineNumber: 4,
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

  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.game.gameState.turnState.status, "IN_PROGRESS");
  assert.equal(next.game.gameState.strikeCount, 2);
  assert.equal(next.game.gameState.maxStrikeCount, 3);
  assert.equal(next.game.lastTurnEvaluation.feedbackMessage, "late result");
  assert.equal(next.editor.markers[0].message, "old turn issue");
});

test("applyTurnEvaluated derives max strike count from remaining strikes when missing", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      gameState: {
        status: "IN_PROGRESS",
        turnState: state.game.gameState.turnState,
      },
    },
  }));

  const next = applyTurnEvaluated(store.getState(), {
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
      strikeCount: 2,
      remainingStrikeCount: 4,
      feedbackMessage: "derived strikes",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.strikeCount, 2);
  assert.equal(next.game.gameState.maxStrikeCount, 6);
  assert.equal(next.game.gameState.turnState.status, "SUBMITTED");
});

test("applyTurnEvaluated clamps max strike count so it never drops below used strikes", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      gameState: {
        ...state.game.gameState,
        maxStrikeCount: 1,
      },
    },
  }));

  const next = applyTurnEvaluated(store.getState(), {
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
      strikeCount: 3,
      remainingStrikeCount: 0,
      feedbackMessage: "exhausted",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.strikeCount, 3);
  assert.equal(next.game.gameState.maxStrikeCount, 3);
});

test("applyTurnEvaluated ignores inactive room evaluation payloads", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const next = applyTurnEvaluated(previous, {
    gameRoomId: "other-room",
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
      feedbackMessage: "ignored",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "ignored marker",
          filePath: "main.py",
          lineNumber: 1,
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

  assert.equal(next, previous);
  assert.equal(next.game.lastTurnEvaluation, null);
  assert.deepEqual(next.editor.markers, []);
});

test("applyTurnChanged builds a fallback turn state from backend-first identifiers", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    currentTurnId: "turn-2",
    currentTurnUserId: "user-2",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.gameState.turnState.turnId, "turn-2");
  assert.equal(next.game.gameState.turnState.turnNumber, 2);
  assert.equal(next.game.gameState.turnState.currentPlayerId, "user-2");
  assert.equal(next.game.gameState.turnState.startedAt, "2026-05-25T10:11:00Z");
  assert.equal(next.game.gameState.turnState.deadlineAt, "2026-05-25T10:11:30.000Z");
  assert.equal(next.game.lastTurnEvaluation, null);
  assert.equal(next.game.turnSubmissionPending, false);
  assert.deepEqual(next.editor.markers, []);
});

test("applyTurnChanged falls back to room time limit when previous turn timing is absent", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    game: {
      ...state.game,
      gameState: {
        status: "IN_PROGRESS",
        timeLimitSeconds: undefined,
      },
    },
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
        timeLimitSeconds: 45,
        maxStrikeCount: 3,
        minParticipants: 2,
        maxParticipants: 4,
        createdAt: "2026-05-25T10:00:00Z",
        updatedAt: "2026-05-25T10:05:00Z",
      },
      roomWaitingState: null,
    },
  }));

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    currentTurnId: "turn-1",
    currentTurnUserId: "user-1",
    occurredAt: "2026-05-25T10:12:00Z",
  });

  assert.equal(next.game.gameState.turnState.timeLimitSeconds, 45);
  assert.equal(next.game.gameState.turnState.remainingTimeSeconds, 45);
  assert.equal(next.game.gameState.turnState.deadlineAt, "2026-05-25T10:12:45.000Z");
});

test("applyTurnChanged preserves previous mission state when event mission state is null", () => {
  const store = createAppStore();
  seedGameplayStore(store);

  const next = applyTurnChanged(store.getState(), {
    gameRoomId: "room-1",
    missionState: null,
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
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next.game.missionState.missionId, "mission-1");
  assert.equal(next.game.missionState.title, "Mission");
  assert.equal(next.room.roomWaitingState, null);
});

test("applyTurnChanged returns the same state when fallback payload is incomplete", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  const previous = store.getState();

  const next = applyTurnChanged(previous, {
    gameRoomId: "room-1",
    currentTurnId: "turn-2",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(next, previous);
  assert.equal(next.game.gameState.turnState.turnId, "turn-1");
});

test("applyMissionResult merges final room metadata and clears submit lock", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    realtime: {
      ...state.realtime,
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
    room: {
      ...state.room,
      currentRoom: {
        gameRoomId: "room-1",
        status: "IN_PROGRESS",
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
      },
      roomWaitingState: {
        currentRoom: {
          gameRoomId: "room-1",
          status: "IN_PROGRESS",
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
        },
        participants: [],
        changedParticipant: null,
        gameState: state.game.gameState,
        missionState: state.game.missionState,
      },
    },
  }));

  const result = applyMissionResult(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "FINISHED",
      difficulty: "HARD",
      timeLimitSeconds: 60,
      maxStrikeCount: 5,
      turnState: {
        turnId: "turn-1",
        turnNumber: 1,
        currentPlayerId: "user-1",
        startedAt: "2026-05-25T10:10:00Z",
        deadlineAt: "2026-05-25T10:11:00Z",
        timeLimitSeconds: 60,
        remainingTimeSeconds: 0,
        status: "SUBMITTED",
      },
    },
    missionResult: {
      missionId: "mission-1",
      isMissionCleared: true,
      judgeStatus: "PASSED",
      selectedInputs: ["1 2"],
      expectedOutputs: ["3"],
      actualOutputs: ["3"],
      strikeCount: 0,
      remainingStrikeCount: 5,
      feedbackMessage: "cleared",
      detectedIssues: [],
    },
    occurredAt: "2026-05-25T10:12:00Z",
  });

  assert.equal(result.navigationTarget, "/rooms/room-1/result");
  assert.equal(result.state.game.turnSubmissionPending, false);
  assert.equal(result.state.game.gameState.status, "FINISHED");
  assert.equal(result.state.room.currentRoom.status, "FINISHED");
  assert.equal(result.state.room.currentRoom.difficulty, "HARD");
  assert.equal(result.state.room.currentRoom.timeLimitSeconds, 60);
  assert.equal(result.state.room.currentRoom.joinedParticipantCount, 2);
  assert.equal(result.state.room.roomWaitingState.gameState.status, "FINISHED");
});

test("applyMissionResult still routes to result when the current room snapshot is absent", () => {
  const store = createAppStore();
  seedGameplayStore(store);
  store.setState((state) => ({
    ...state,
    room: {
      ...state.room,
      currentRoom: null,
      roomWaitingState: null,
    },
  }));

  const result = applyMissionResult(store.getState(), {
    gameRoomId: "room-1",
    gameState: {
      status: "FINISHED",
    },
    missionResult: {
      missionId: "mission-1",
      isMissionCleared: false,
      judgeStatus: "FAILED",
      selectedInputs: [],
      expectedOutputs: [],
      actualOutputs: [],
      strikeCount: 3,
      remainingStrikeCount: 0,
      feedbackMessage: "failed",
      detectedIssues: [],
    },
    occurredAt: "2026-05-25T10:12:00Z",
  });

  assert.equal(result.navigationTarget, "/rooms/room-1/result");
  assert.equal(result.state.room.currentRoom, null);
  assert.equal(result.state.game.missionResult.feedbackMessage, "failed");
  assert.equal(result.state.game.gameState.status, "FINISHED");
});

test("bindRoomRealtimeEvents applies evaluate, turn-change, and mission-result in order", () => {
  const store = createAppStore();
  seedGameplayStore(store);
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

    handlers.get("turn-evaluated")({
      gameRoomId: "room-1",
      evaluatedTurn: {
        turnId: "turn-1",
        turnNumber: 1,
        playerUserId: "user-1",
        status: "SUBMITTED",
      },
      evaluationResult: {
        isStepCleared: true,
        judgeStatus: "PASSED",
        strikeCount: 0,
        remainingStrikeCount: 3,
        feedbackMessage: "passed",
        detectedIssues: [],
        executionSummary: {
          status: "SUCCESS",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
        },
      },
      occurredAt: "2026-05-25T10:11:00Z",
    });

    assert.equal(store.getState().game.lastTurnEvaluation.feedbackMessage, "passed");
    assert.equal(store.getState().game.turnSubmissionPending, true);

    handlers.get("turn-changed")({
      gameRoomId: "room-1",
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
      occurredAt: "2026-05-25T10:11:00Z",
    });

    assert.equal(store.getState().game.lastTurnEvaluation.feedbackMessage, "passed");
    assert.equal(store.getState().game.turnSubmissionPending, false);
    assert.equal(store.getState().game.gameState.turnState.turnId, "turn-2");

    handlers.get("mission-result")({
      gameRoomId: "room-1",
      gameState: {
        status: "FINISHED",
      },
      missionResult: {
        missionId: "mission-1",
        isMissionCleared: true,
        judgeStatus: "PASSED",
        selectedInputs: ["1 2"],
        expectedOutputs: ["3"],
        actualOutputs: ["3"],
        strikeCount: 0,
        remainingStrikeCount: 3,
        feedbackMessage: "final pass",
        detectedIssues: [],
      },
      occurredAt: "2026-05-25T10:12:00Z",
    });

    assert.deepEqual(navigations, ["/rooms/room-1/result"]);
    assert.equal(store.getState().game.gameState.status, "FINISHED");
    assert.equal(store.getState().game.missionResult.feedbackMessage, "final pass");
  } finally {
    setRealtimeNavigateHandler(null);
  }
});

test("bindRoomRealtimeEvents ignores mission-result payloads without a mission result body", () => {
  const store = createAppStore();
  seedGameplayStore(store);
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

    handlers.get("mission-result")({
      gameRoomId: "room-1",
      gameState: {
        status: "FINISHED",
      },
      occurredAt: "2026-05-25T10:12:00Z",
    });

    assert.deepEqual(navigations, []);
    assert.equal(store.getState().game.missionResult, null);
    assert.equal(store.getState().game.gameState.status, "IN_PROGRESS");
  } finally {
    setRealtimeNavigateHandler(null);
  }
});

test("bindRoomRealtimeEvents ignores turn-changed payloads without any turn identifier", () => {
  const store = createAppStore();
  seedGameplayStore(store);
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

  handlers.get("turn-changed")({
    gameRoomId: "room-1",
    occurredAt: "2026-05-25T10:11:00Z",
  });

  assert.equal(store.getState().game.gameState.turnState.turnId, "turn-1");
  assert.equal(store.getState().game.turnSubmissionPending, true);
});
