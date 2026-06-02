import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMissionFileTabs,
  buildMissionProgressSteps,
  buildParticipantRows,
  buildStrikeHeartDisplay,
  canEditGameplay,
  canMutateMissionFile,
  computeRemainingSeconds,
  formatTurnTimerText,
  getCurrentTurnParticipantLabel,
  getEvaluationDisplayCopy,
  getMissionFileName,
  getMissionDisplayCopy,
  isEditorContentReadOnly,
  resolveActiveFilePath,
} from "../../src/pages/RoomPage/roomPageViewModel.ts";

test("buildMissionFileTabs prefers mission projectStructure files", () => {
  const tabs = buildMissionFileTabs(
    {
      missionId: "mission-1",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "src/main.py",
        files: [
          {
            filePath: "src/main.py",
            language: "python",
            readonly: false,
          },
          {
            filePath: "src/util.py",
            language: "python",
            readonly: true,
          },
        ],
      },
    },
    { "legacy.py": "ignored" },
  );

  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].fileName, "main.py");
  assert.equal(tabs[1].readonly, true);
});

test("buildMissionFileTabs falls back to editor file keys", () => {
  const tabs = buildMissionFileTabs(null, {
    "main.py": "",
    "sub.py": "",
  });

  assert.deepEqual(
    tabs.map((tab) => tab.filePath),
    ["main.py", "sub.py"],
  );
});

test("resolveActiveFilePath keeps a valid active path or uses the first tab", () => {
  const tabs = [
    { filePath: "a.py", fileName: "a.py", language: "python", readonly: false },
    { filePath: "b.py", fileName: "b.py", language: "python", readonly: false },
  ];

  assert.equal(resolveActiveFilePath("b.py", tabs), "b.py");
  assert.equal(resolveActiveFilePath("missing.py", tabs), "a.py");
  assert.equal(resolveActiveFilePath(null, tabs), "a.py");
});

test("canEditGameplay follows current player and IN_PROGRESS turn status", () => {
  const gameState = {
    status: "IN_PROGRESS",
    turnState: {
      turnId: "turn-1",
      turnNumber: 1,
      currentPlayerId: "user-1",
      startedAt: "2026-05-25T10:00:00Z",
      deadlineAt: "2026-05-25T10:00:30Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
  };

  assert.equal(canEditGameplay("user-1", gameState), true);
  assert.equal(canEditGameplay("user-2", gameState), false);
  assert.equal(
    canEditGameplay("user-1", {
      ...gameState,
      turnState: { ...gameState.turnState, status: "SUBMITTED" },
    }),
    false,
  );
});

test("computeRemainingSeconds and formatTurnTimerText derive timer display", () => {
  const deadlineAt = "2026-05-25T10:00:30.000Z";
  const now = Date.parse("2026-05-25T10:00:12.000Z");

  assert.equal(computeRemainingSeconds(deadlineAt, now), 18);
  assert.equal(formatTurnTimerText(18), "00 : 18");
  assert.equal(formatTurnTimerText(125), "02 : 05");
});

test("computeRemainingSeconds applies a countdown offset when gameplay starts after intro", () => {
  const deadlineAt = "2026-05-25T10:00:30.000Z";
  const now = Date.parse("2026-05-25T10:00:06.000Z");

  assert.equal(computeRemainingSeconds(deadlineAt, now, 6000), 30);
});

test("buildStrikeHeartDisplay computes remaining team lives", () => {
  assert.deepEqual(buildStrikeHeartDisplay(1, 3), {
    remaining: 2,
    lost: 1,
  });
});

test("buildParticipantRows marks current user and current turn", () => {
  const rows = buildParticipantRows(
    [
      {
        userId: "user-1",
        nickname: "Alpha",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-2",
        nickname: "Beta",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-3",
        nickname: "Gamma",
        membershipStatus: "INVITED",
        role: "PARTICIPANT",
      },
    ],
    "user-2",
    "user-1",
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].isCurrentUser, true);
  assert.equal(rows[1].roleLabel, "방장");
  assert.equal(rows[1].isCurrentTurn, true);
});

test("getMissionDisplayCopy prefers authoritative mission title and description", () => {
  assert.deepEqual(
    getMissionDisplayCopy({
      missionId: "mission-1",
      title: "정렬 미션",
      description: "배열을 정렬하세요.",
    }),
    {
      title: "정렬 미션",
      description: "배열을 정렬하세요.",
    },
  );
});

test("getMissionDisplayCopy exposes explicit fallback copy when description is missing", () => {
  assert.deepEqual(
    getMissionDisplayCopy({
      missionId: "mission-1",
      title: "정렬 미션",
    }),
    {
      title: "정렬 미션",
      description: "미션 설명이 아직 도착하지 않았습니다.",
    },
  );
});

test("buildMissionProgressSteps renders the full mission step list when available", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-1",
    gameRoomMissionStepId: "step-2",
    currentStepStatus: "IN_PROGRESS",
    steps: [
      {
        gameRoomMissionStepId: "step-1",
        missionTemplateStepId: "template-step-1",
        stepOrder: 1,
        title: "입력 파싱",
        description: "첫 줄과 연산자를 읽어옵니다.",
        status: "CLEARED",
      },
      {
        gameRoomMissionStepId: "step-2",
        missionTemplateStepId: "template-step-2",
        stepOrder: 2,
        title: "계산 수행",
        description: "연산 결과를 계산합니다.",
        status: "IN_PROGRESS",
      },
    ],
  });

  assert.equal(steps.length, 2);
  assert.equal(steps[0].stepOrder, 1);
  assert.equal(steps[0].isActive, false);
  assert.equal(steps[1].title, "계산 수행");
  assert.equal(steps[1].isActive, true);
});

test("getCurrentTurnParticipantLabel reports the current turn owner", () => {
  assert.equal(
    getCurrentTurnParticipantLabel([
      {
        userId: "user-1",
        nickname: "Alpha",
        isCurrentUser: false,
        isCurrentTurn: false,
        roleLabel: null,
      },
      {
        userId: "user-2",
        nickname: "Beta",
        isCurrentUser: true,
        isCurrentTurn: true,
        roleLabel: "방장",
      },
    ]),
    "현재 턴: 나",
  );
});

test("getEvaluationDisplayCopy reflects evaluation feedback and issue count", () => {
  assert.deepEqual(
    getEvaluationDisplayCopy({
      turnSubmissionPending: false,
      evaluation: {
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
          {
            issueType: "ASSERTION_ERROR",
            message: "출력 불일치",
            filePath: "main.py",
            lineNumber: 5,
          },
        ],
        executionSummary: {
          status: "SUCCESS",
          exitCode: 0,
          stdout: "",
          stderr: "",
        },
      },
    }),
    {
      statusLabel: "재검토 필요",
      analysisNotice: "조건 불일치",
      feedbackMessage: "조건 불일치",
      errorMessage: "2개 이슈 감지 · 짝수 조건 누락",
    },
  );
});

test("getMissionFileName returns the basename", () => {
  assert.equal(getMissionFileName("src/main.py"), "main.py");
});

test("canMutateMissionFile blocks readonly tabs even during an editable turn", () => {
  const readonlyTab = {
    filePath: "src/util.py",
    fileName: "util.py",
    language: "python",
    readonly: true,
  };
  const editableTab = {
    filePath: "src/main.py",
    fileName: "main.py",
    language: "python",
    readonly: false,
  };

  assert.equal(canMutateMissionFile(true, readonlyTab), false);
  assert.equal(canMutateMissionFile(true, editableTab), true);
});

test("isEditorContentReadOnly mirrors RoomPage textarea locking rules", () => {
  const readonlyTab = {
    filePath: "util.py",
    fileName: "util.py",
    language: "python",
    readonly: true,
  };

  assert.equal(
    isEditorContentReadOnly({
      canEditTurn: true,
      tab: readonlyTab,
      isTurnExpired: false,
      isMissionGuideOpen: false,
      isRealtimeUnavailable: false,
    }),
    true,
  );
  assert.equal(
    isEditorContentReadOnly({
      canEditTurn: true,
      tab: { ...readonlyTab, readonly: false },
      isTurnExpired: false,
      isMissionGuideOpen: false,
      isRealtimeUnavailable: false,
    }),
    false,
  );
});
