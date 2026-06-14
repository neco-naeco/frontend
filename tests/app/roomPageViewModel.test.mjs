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
  findMissionFileTab,
  formatTurnTimerText,
  getCurrentTurnParticipantLabel,
  getEvaluationDisplayCopy,
  getLanguageDisplayLabel,
  getMissionFileName,
  getMissionDisplayCopy,
  getMissionStepStatusLabel,
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

test("buildMissionFileTabs preserves mission file order and metadata", () => {
  const missionState = {
    missionId: "mission-order",
    language: "python",
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
          filePath: "src/lib/solver.py",
          language: "python",
          readonly: false,
        },
        {
          filePath: "README.md",
          language: "markdown",
          readonly: true,
        },
      ],
    },
  };

  assert.deepEqual(buildMissionFileTabs(missionState, {}), [
    {
      filePath: "src/main.py",
      fileName: "main.py",
      language: "python",
      readonly: false,
    },
    {
      filePath: "src/lib/solver.py",
      fileName: "solver.py",
      language: "python",
      readonly: false,
    },
    {
      filePath: "README.md",
      fileName: "README.md",
      language: "markdown",
      readonly: true,
    },
  ]);
});

test("buildMissionFileTabs ignores editor fallback when mission files exist", () => {
  const tabs = buildMissionFileTabs(
    {
      missionId: "mission-with-files",
      language: "python",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "answer.py",
        files: [
          {
            filePath: "answer.py",
            language: "python",
            readonly: false,
          },
        ],
      },
    },
    {
      "stale.py": "print('stale')",
      "draft.py": "print('draft')",
    },
  );

  assert.deepEqual(tabs, [
    {
      filePath: "answer.py",
      fileName: "answer.py",
      language: "python",
      readonly: false,
    },
  ]);
});

test("buildMissionFileTabs uses mission language for editor fallback files", () => {
  const tabs = buildMissionFileTabs(
    {
      missionId: "mission-js",
      language: "javascript",
    },
    {
      "index.js": "console.log(1)",
      "utils/math.js": "export const sum = () => 0",
    },
  );

  assert.deepEqual(tabs, [
    {
      filePath: "index.js",
      fileName: "index.js",
      language: "javascript",
      readonly: false,
    },
    {
      filePath: "utils/math.js",
      fileName: "math.js",
      language: "javascript",
      readonly: false,
    },
  ]);
});

test("buildMissionFileTabs uses text language when no mission language exists", () => {
  const tabs = buildMissionFileTabs(
    {
      missionId: "mission-text-fallback",
    },
    {
      "notes.txt": "hello",
    },
  );

  assert.deepEqual(tabs, [
    {
      filePath: "notes.txt",
      fileName: "notes.txt",
      language: "text",
      readonly: false,
    },
  ]);
});

test("resolveActiveFilePath returns null when no tabs exist", () => {
  assert.equal(resolveActiveFilePath("main.py", []), null);
  assert.equal(resolveActiveFilePath(null, []), null);
});

test("findMissionFileTab returns the active tab only for known paths", () => {
  const tabs = [
    {
      filePath: "main.py",
      fileName: "main.py",
      language: "python",
      readonly: false,
    },
    {
      filePath: "helper.py",
      fileName: "helper.py",
      language: "python",
      readonly: true,
    },
  ];

  assert.deepEqual(findMissionFileTab(tabs, "helper.py"), {
    filePath: "helper.py",
    fileName: "helper.py",
    language: "python",
    readonly: true,
  });
  assert.equal(findMissionFileTab(tabs, "missing.py"), undefined);
  assert.equal(findMissionFileTab(tabs, null), undefined);
  assert.equal(findMissionFileTab(tabs, undefined), undefined);
});

test("getMissionFileName keeps single segment paths intact", () => {
  assert.equal(getMissionFileName("main.py"), "main.py");
  assert.equal(getMissionFileName("README.md"), "README.md");
});

test("getMissionFileName falls back to the original value for trailing slash paths", () => {
  assert.equal(getMissionFileName("src/"), "src/");
  assert.equal(getMissionFileName("nested/path/"), "nested/path/");
});

test("canMutateMissionFile blocks missing tabs and non-editable turns", () => {
  const editableTab = {
    filePath: "main.py",
    fileName: "main.py",
    language: "python",
    readonly: false,
  };

  assert.equal(canMutateMissionFile(false, editableTab), false);
  assert.equal(canMutateMissionFile(true, undefined), false);
  assert.equal(canMutateMissionFile(false, undefined), false);
});

test("isEditorContentReadOnly locks editor for each blocking condition", () => {
  const editableTab = {
    filePath: "main.py",
    fileName: "main.py",
    language: "python",
    readonly: false,
  };
  const blockingCases = [
    {
      name: "turn is not editable",
      input: {
        canEditTurn: false,
        tab: editableTab,
        isTurnExpired: false,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: false,
      },
    },
    {
      name: "turn expired",
      input: {
        canEditTurn: true,
        tab: editableTab,
        isTurnExpired: true,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: false,
      },
    },
    {
      name: "mission guide open",
      input: {
        canEditTurn: true,
        tab: editableTab,
        isTurnExpired: false,
        isMissionGuideOpen: true,
        isRealtimeUnavailable: false,
      },
    },
    {
      name: "realtime unavailable",
      input: {
        canEditTurn: true,
        tab: editableTab,
        isTurnExpired: false,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: true,
      },
    },
    {
      name: "missing tab",
      input: {
        canEditTurn: true,
        tab: undefined,
        isTurnExpired: false,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: false,
      },
    },
  ];

  for (const testCase of blockingCases) {
    assert.equal(
      isEditorContentReadOnly(testCase.input),
      testCase.name === "missing tab" ? false : true,
      testCase.name,
    );
  }
});

test("canEditGameplay rejects missing auth, missing turn, and non-current players", () => {
  const gameState = {
    status: "IN_PROGRESS",
    turnState: {
      turnId: "turn-2",
      turnNumber: 2,
      currentPlayerId: "user-2",
      startedAt: "2026-05-25T10:00:00Z",
      deadlineAt: "2026-05-25T10:00:30Z",
      timeLimitSeconds: 30,
      remainingTimeSeconds: 30,
      status: "IN_PROGRESS",
    },
  };

  assert.equal(canEditGameplay(null, gameState), false);
  assert.equal(canEditGameplay(undefined, gameState), false);
  assert.equal(canEditGameplay("user-1", gameState), false);
  assert.equal(canEditGameplay("user-2", null), false);
  assert.equal(canEditGameplay("user-2", { status: "IN_PROGRESS" }), false);
});

test("canEditGameplay accepts only active current player turns", () => {
  const baseTurnState = {
    turnId: "turn-status",
    turnNumber: 4,
    currentPlayerId: "user-1",
    startedAt: "2026-05-25T10:00:00Z",
    deadlineAt: "2026-05-25T10:00:30Z",
    timeLimitSeconds: 30,
    remainingTimeSeconds: 30,
  };
  const acceptedState = {
    status: "IN_PROGRESS",
    turnState: {
      ...baseTurnState,
      status: "IN_PROGRESS",
    },
  };
  const rejectedStatuses = ["SUBMITTED", "EVALUATING", "COMPLETED", "FAILED"];

  assert.equal(canEditGameplay("user-1", acceptedState), true);

  for (const status of rejectedStatuses) {
    assert.equal(
      canEditGameplay("user-1", {
        status: "IN_PROGRESS",
        turnState: {
          ...baseTurnState,
          status,
        },
      }),
      false,
      status,
    );
  }
});

test("computeRemainingSeconds floors impossible or expired deadlines to zero", () => {
  const now = Date.parse("2026-05-25T10:00:30.000Z");

  assert.equal(computeRemainingSeconds(undefined, now), 0);
  assert.equal(computeRemainingSeconds("not-a-date", now), 0);
  assert.equal(computeRemainingSeconds("2026-05-25T10:00:20.000Z", now), 0);
});

test("computeRemainingSeconds rounds partial seconds up for countdown display", () => {
  const now = Date.parse("2026-05-25T10:00:00.250Z");

  assert.equal(computeRemainingSeconds("2026-05-25T10:00:01.000Z", now), 1);
  assert.equal(computeRemainingSeconds("2026-05-25T10:00:01.001Z", now), 1);
  assert.equal(computeRemainingSeconds("2026-05-25T10:00:01.251Z", now), 2);
});

test("formatTurnTimerText formats long running timers without truncation", () => {
  assert.equal(formatTurnTimerText(0), "00 : 00");
  assert.equal(formatTurnTimerText(5), "00 : 05");
  assert.equal(formatTurnTimerText(3599), "59 : 59");
  assert.equal(formatTurnTimerText(3600), "60 : 00");
  assert.equal(formatTurnTimerText(3661), "61 : 01");
});

test("buildStrikeHeartDisplay clamps negative, missing, and overflow counts", () => {
  assert.deepEqual(buildStrikeHeartDisplay(undefined, undefined), {
    remaining: 0,
    lost: 0,
  });
  assert.deepEqual(buildStrikeHeartDisplay(-1, 3), {
    remaining: 3,
    lost: 0,
  });
  assert.deepEqual(buildStrikeHeartDisplay(5, 3), {
    remaining: 0,
    lost: 3,
  });
  assert.deepEqual(buildStrikeHeartDisplay(1, -3), {
    remaining: 0,
    lost: 0,
  });
});

test("getLanguageDisplayLabel trims and normalizes python labels", () => {
  assert.equal(getLanguageDisplayLabel(undefined), null);
  assert.match(getLanguageDisplayLabel("python"), /Python$/);
  assert.match(getLanguageDisplayLabel(" PYTHON "), /Python$/);
  assert.equal(getLanguageDisplayLabel("JavaScript"), "JavaScript");
});

test("buildParticipantRows filters non-joined participants and keeps row order", () => {
  const rows = buildParticipantRows(
    [
      {
        userId: "owner",
        nickname: "Owner",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "left-user",
        nickname: "Left",
        role: "PARTICIPANT",
        membershipStatus: "LEFT",
      },
      {
        userId: "player",
        nickname: "Player",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
    "player",
    "owner",
  );

  assert.deepEqual(
    rows.map((row) => row.userId),
    ["owner", "player"],
  );
  assert.equal(rows[0].isCurrentUser, true);
  assert.equal(rows[0].isCurrentTurn, false);
  assert.equal(rows[0].roleLabel, "방장");
  assert.equal(rows[1].isCurrentTurn, true);
  assert.equal(rows[1].roleLabel, null);
});

test("buildParticipantRows handles empty participant lists", () => {
  assert.deepEqual(buildParticipantRows([], "user-1", "user-1"), []);
});

test("getCurrentTurnParticipantLabel returns a waiting copy when no row owns the turn", () => {
  const label = getCurrentTurnParticipantLabel([
    {
      userId: "user-1",
      nickname: "Alpha",
      isCurrentUser: false,
      isCurrentTurn: false,
      roleLabel: null,
    },
  ]);

  assert.equal(typeof label, "string");
  assert.ok(label.length > 0);
  assert.notEqual(label, "Alpha");
});

test("getCurrentTurnParticipantLabel uses nickname for another current player", () => {
  const label = getCurrentTurnParticipantLabel([
    {
      userId: "user-1",
      nickname: "Alpha",
      isCurrentUser: false,
      isCurrentTurn: true,
      roleLabel: null,
    },
  ]);

  assert.ok(label.includes("Alpha"));
});

test("getMissionDisplayCopy trims provided title and description", () => {
  assert.deepEqual(
    getMissionDisplayCopy({
      missionId: "mission-trim",
      title: "  Trimmed title  ",
      description: "  Trimmed description  ",
    }),
    {
      title: "Trimmed title",
      description: "Trimmed description",
    },
  );
});

test("getMissionDisplayCopy uses loading title when mission state is missing", () => {
  const copy = getMissionDisplayCopy(null);

  assert.equal(typeof copy.title, "string");
  assert.equal(typeof copy.description, "string");
  assert.ok(copy.title.length > 0);
  assert.ok(copy.description.length > 0);
});

test("buildMissionProgressSteps returns no steps before mission hydration", () => {
  assert.deepEqual(buildMissionProgressSteps(null), []);
});

test("buildMissionProgressSteps falls back to current mission step fields", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-single",
    currentStepId: "current-step",
    gameRoomMissionStepId: "game-room-step",
    currentStepStatus: "IN_PROGRESS",
    stepOrder: 3,
    stepTitle: "Implement parser",
    stepDescription: "Parse user input.",
    title: "Parser mission",
    description: "Mission fallback",
  });

  assert.deepEqual(steps, [
    {
      key: "current-step",
      stepOrder: 3,
      title: "Implement parser",
      description: "Parse user input.",
      status: "IN_PROGRESS",
      isActive: true,
    },
  ]);
});

test("buildMissionProgressSteps falls back through mission title and description", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-fallback",
    currentStepStatus: "READY",
    title: "Mission title",
    description: "Mission description",
  });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].key, "mission-fallback");
  assert.equal(steps[0].stepOrder, 1);
  assert.equal(steps[0].title, "Mission title");
  assert.equal(steps[0].description, "Mission description");
  assert.equal(steps[0].status, "READY");
  assert.equal(steps[0].isActive, true);
});

test("buildMissionProgressSteps uses step order as key when backend id is missing", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-no-step-id",
    gameRoomMissionStepId: "active-step",
    currentStepStatus: "IN_PROGRESS",
    steps: [
      {
        missionTemplateStepId: "template-1",
        stepOrder: 1,
        title: "",
        description: "",
        status: "READY",
      },
      {
        gameRoomMissionStepId: "active-step",
        missionTemplateStepId: "template-2",
        stepOrder: 2,
        title: "Active step",
        description: "Active description",
        status: "IN_PROGRESS",
      },
    ],
  });

  assert.equal(steps[0].key, "1");
  assert.equal(steps[0].title, "Step 1");
  assert.equal(steps[0].description, "Step description is not available yet.");
  assert.equal(steps[0].isActive, false);
  assert.equal(steps[1].key, "active-step");
  assert.equal(steps[1].isActive, true);
});

test("getMissionStepStatusLabel returns a non-empty label for every reflected status", () => {
  for (const status of ["LOCKED", "READY", "IN_PROGRESS", "CLEARED", "FAILED"]) {
    const label = getMissionStepStatusLabel(status);

    assert.equal(typeof label, "string");
    assert.ok(label.length > 0);
  }

  assert.equal(typeof getMissionStepStatusLabel(undefined), "string");
});

test("getEvaluationDisplayCopy reports pending submission before evaluation arrives", () => {
  const copy = getEvaluationDisplayCopy({
    evaluation: null,
    turnSubmissionPending: true,
  });

  assert.equal(typeof copy.statusLabel, "string");
  assert.equal(typeof copy.analysisNotice, "string");
  assert.equal(typeof copy.feedbackMessage, "string");
  assert.equal(typeof copy.errorMessage, "string");
  assert.ok(copy.statusLabel.length > 0);
  assert.ok(copy.analysisNotice.length > 0);
  assert.ok(copy.feedbackMessage.length > 0);
  assert.ok(copy.errorMessage.length > 0);
});

test("getEvaluationDisplayCopy reports idle copy before any turn submission", () => {
  const copy = getEvaluationDisplayCopy({
    evaluation: null,
    turnSubmissionPending: false,
  });

  assert.equal(typeof copy.statusLabel, "string");
  assert.equal(typeof copy.analysisNotice, "string");
  assert.equal(typeof copy.feedbackMessage, "string");
  assert.equal(typeof copy.errorMessage, "string");
  assert.ok(copy.statusLabel.length > 0);
  assert.ok(copy.analysisNotice.length > 0);
  assert.ok(copy.feedbackMessage.length > 0);
  assert.ok(copy.errorMessage.length > 0);
});

test("getEvaluationDisplayCopy uses fallback feedback for passed evaluations without message", () => {
  const copy = getEvaluationDisplayCopy({
    turnSubmissionPending: false,
    evaluation: {
      isStepCleared: true,
      judgeStatus: "PASSED",
      strikeCount: 0,
      remainingStrikeCount: 3,
      feedbackMessage: "   ",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      },
    },
  });

  assert.equal(typeof copy.statusLabel, "string");
  assert.equal(typeof copy.analysisNotice, "string");
  assert.equal(typeof copy.feedbackMessage, "string");
  assert.equal(typeof copy.errorMessage, "string");
  assert.ok(copy.statusLabel.length > 0);
  assert.ok(copy.analysisNotice.length > 0);
  assert.ok(copy.feedbackMessage.length > 0);
  assert.ok(copy.errorMessage.length > 0);
});

test("getEvaluationDisplayCopy includes first detected issue message only", () => {
  const copy = getEvaluationDisplayCopy({
    turnSubmissionPending: false,
    evaluation: {
      isStepCleared: false,
      judgeStatus: "FAILED",
      strikeCount: 2,
      remainingStrikeCount: 1,
      feedbackMessage: "",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "first issue",
          filePath: "main.py",
          lineNumber: 1,
        },
        {
          issueType: "STYLE_ERROR",
          message: "second issue",
          filePath: "main.py",
          lineNumber: 2,
        },
      ],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
  });

  assert.ok(copy.errorMessage.includes("2"));
  assert.ok(copy.errorMessage.includes("first issue"));
  assert.equal(copy.errorMessage.includes("second issue"), false);
});

test("buildMissionFileTabs supports nested file names across common source layouts", () => {
  const tabs = buildMissionFileTabs(
    {
      missionId: "mission-nested-files",
      language: "python",
      projectStructure: {
        rootPath: "/workspace",
        entryFilePath: "src/app/main.py",
        files: [
          {
            filePath: "src/app/main.py",
            language: "python",
            readonly: false,
          },
          {
            filePath: "src/app/domain/entities.py",
            language: "python",
            readonly: false,
          },
          {
            filePath: "src/app/services/submission_service.py",
            language: "python",
            readonly: false,
          },
          {
            filePath: "tests/test_submission_service.py",
            language: "python",
            readonly: true,
          },
          {
            filePath: "docs/problem.md",
            language: "markdown",
            readonly: true,
          },
        ],
      },
    },
    {},
  );

  assert.deepEqual(
    tabs.map((tab) => tab.fileName),
    [
      "main.py",
      "entities.py",
      "submission_service.py",
      "test_submission_service.py",
      "problem.md",
    ],
  );
  assert.deepEqual(
    tabs.map((tab) => tab.readonly),
    [false, false, false, true, true],
  );
});

test("resolveActiveFilePath handles every selected path transition", () => {
  const tabs = [
    {
      filePath: "src/main.py",
      fileName: "main.py",
      language: "python",
      readonly: false,
    },
    {
      filePath: "src/solution.py",
      fileName: "solution.py",
      language: "python",
      readonly: false,
    },
    {
      filePath: "README.md",
      fileName: "README.md",
      language: "markdown",
      readonly: true,
    },
  ];
  const cases = [
    {
      activeFilePath: "src/main.py",
      expected: "src/main.py",
    },
    {
      activeFilePath: "src/solution.py",
      expected: "src/solution.py",
    },
    {
      activeFilePath: "README.md",
      expected: "README.md",
    },
    {
      activeFilePath: "src/missing.py",
      expected: "src/main.py",
    },
    {
      activeFilePath: "",
      expected: "src/main.py",
    },
    {
      activeFilePath: null,
      expected: "src/main.py",
    },
  ];

  for (const testCase of cases) {
    assert.equal(
      resolveActiveFilePath(testCase.activeFilePath, tabs),
      testCase.expected,
      String(testCase.activeFilePath),
    );
  }
});

test("isEditorContentReadOnly keeps editable files open across allowed combinations", () => {
  const editableTab = {
    filePath: "src/main.py",
    fileName: "main.py",
    language: "python",
    readonly: false,
  };
  const allowedCases = [
    {
      name: "normal active turn",
      input: {
        canEditTurn: true,
        tab: editableTab,
        isTurnExpired: false,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: false,
      },
    },
    {
      name: "missing tab still leaves textarea technically writable",
      input: {
        canEditTurn: true,
        tab: undefined,
        isTurnExpired: false,
        isMissionGuideOpen: false,
        isRealtimeUnavailable: false,
      },
    },
  ];

  for (const testCase of allowedCases) {
    assert.equal(isEditorContentReadOnly(testCase.input), false, testCase.name);
  }
});

test("computeRemainingSeconds applies offset without allowing negative output", () => {
  const now = Date.parse("2026-05-25T10:00:30.000Z");
  const cases = [
    {
      deadlineAt: "2026-05-25T10:00:00.000Z",
      extraMilliseconds: 0,
      expected: 0,
    },
    {
      deadlineAt: "2026-05-25T10:00:00.000Z",
      extraMilliseconds: 15_000,
      expected: 0,
    },
    {
      deadlineAt: "2026-05-25T10:00:00.000Z",
      extraMilliseconds: 30_000,
      expected: 0,
    },
    {
      deadlineAt: "2026-05-25T10:00:00.000Z",
      extraMilliseconds: 31_000,
      expected: 1,
    },
    {
      deadlineAt: "2026-05-25T10:00:20.000Z",
      extraMilliseconds: 15_000,
      expected: 5,
    },
  ];

  for (const testCase of cases) {
    assert.equal(
      computeRemainingSeconds(
        testCase.deadlineAt,
        now,
        testCase.extraMilliseconds,
      ),
      testCase.expected,
    );
  }
});

test("buildStrikeHeartDisplay handles common gameplay strike states", () => {
  const cases = [
    {
      strikeCount: 0,
      maxStrikeCount: 3,
      expected: {
        remaining: 3,
        lost: 0,
      },
    },
    {
      strikeCount: 1,
      maxStrikeCount: 3,
      expected: {
        remaining: 2,
        lost: 1,
      },
    },
    {
      strikeCount: 2,
      maxStrikeCount: 3,
      expected: {
        remaining: 1,
        lost: 2,
      },
    },
    {
      strikeCount: 3,
      maxStrikeCount: 3,
      expected: {
        remaining: 0,
        lost: 3,
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      buildStrikeHeartDisplay(testCase.strikeCount, testCase.maxStrikeCount),
      testCase.expected,
    );
  }
});

test("buildParticipantRows marks only one current user and one current turn", () => {
  const rows = buildParticipantRows(
    [
      {
        userId: "user-1",
        nickname: "Alpha",
        role: "OWNER",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-2",
        nickname: "Beta",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
      {
        userId: "user-3",
        nickname: "Gamma",
        role: "PARTICIPANT",
        membershipStatus: "JOINED",
      },
    ],
    "user-3",
    "user-2",
  );

  assert.deepEqual(
    rows.map((row) => ({
      isCurrentTurn: row.isCurrentTurn,
      isCurrentUser: row.isCurrentUser,
      userId: row.userId,
    })),
    [
      {
        isCurrentTurn: false,
        isCurrentUser: false,
        userId: "user-1",
      },
      {
        isCurrentTurn: false,
        isCurrentUser: true,
        userId: "user-2",
      },
      {
        isCurrentTurn: true,
        isCurrentUser: false,
        userId: "user-3",
      },
    ],
  );
});

test("buildMissionProgressSteps keeps backend ordering and active status independent", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-progress-order",
    gameRoomMissionStepId: "step-3",
    currentStepStatus: "IN_PROGRESS",
    steps: [
      {
        gameRoomMissionStepId: "step-1",
        missionTemplateStepId: "template-1",
        stepOrder: 1,
        title: "Read input",
        description: "Read all input values.",
        status: "CLEARED",
      },
      {
        gameRoomMissionStepId: "step-2",
        missionTemplateStepId: "template-2",
        stepOrder: 2,
        title: "Transform values",
        description: "Transform intermediate values.",
        status: "FAILED",
      },
      {
        gameRoomMissionStepId: "step-3",
        missionTemplateStepId: "template-3",
        stepOrder: 3,
        title: "Print answer",
        description: "Print final result.",
        status: "READY",
      },
    ],
  });

  assert.deepEqual(
    steps.map((step) => step.key),
    ["step-1", "step-2", "step-3"],
  );
  assert.deepEqual(
    steps.map((step) => step.status),
    ["CLEARED", "FAILED", "READY"],
  );
  assert.deepEqual(
    steps.map((step) => step.isActive),
    [false, false, true],
  );
});

test("buildMissionProgressSteps supplies stable fallback copy for blank listed steps", () => {
  const steps = buildMissionProgressSteps({
    missionId: "mission-blank-steps",
    gameRoomMissionStepId: "blank-step-2",
    currentStepStatus: "IN_PROGRESS",
    steps: [
      {
        gameRoomMissionStepId: "blank-step-1",
        missionTemplateStepId: "template-1",
        stepOrder: 1,
        title: "   ",
        description: "   ",
        status: "READY",
      },
      {
        gameRoomMissionStepId: "blank-step-2",
        missionTemplateStepId: "template-2",
        stepOrder: 2,
        title: "",
        description: "",
        status: "IN_PROGRESS",
      },
    ],
  });

  assert.equal(steps[0].title, "   ");
  assert.equal(steps[0].description, "   ");
  assert.equal(steps[1].title, "Step 2");
  assert.equal(steps[1].description, "Step description is not available yet.");
});

test("getEvaluationDisplayCopy preserves explicit feedback whitespace trimming", () => {
  const copy = getEvaluationDisplayCopy({
    turnSubmissionPending: false,
    evaluation: {
      isStepCleared: true,
      judgeStatus: "PASSED",
      strikeCount: 0,
      remainingStrikeCount: 3,
      feedbackMessage: "  Looks good  ",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      },
    },
  });

  assert.equal(copy.analysisNotice, "Looks good");
  assert.equal(copy.feedbackMessage, "Looks good");
});

test("getEvaluationDisplayCopy reports clean execution when no issues are detected", () => {
  const copy = getEvaluationDisplayCopy({
    turnSubmissionPending: false,
    evaluation: {
      isStepCleared: true,
      judgeStatus: "PASSED",
      strikeCount: 0,
      remainingStrikeCount: 3,
      feedbackMessage: "Passed",
      detectedIssues: [],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      },
    },
  });

  assert.equal(copy.statusLabel.length > 0, true);
  assert.equal(copy.errorMessage.includes("0"), false);
  assert.equal(copy.errorMessage.includes("Passed"), false);
});

test("getEvaluationDisplayCopy handles issue entries without message text", () => {
  const copy = getEvaluationDisplayCopy({
    turnSubmissionPending: false,
    evaluation: {
      isStepCleared: false,
      judgeStatus: "FAILED",
      strikeCount: 1,
      remainingStrikeCount: 2,
      feedbackMessage: "Review needed",
      detectedIssues: [
        {
          issueType: "LOGIC_ERROR",
          message: "   ",
          filePath: "main.py",
          lineNumber: 10,
        },
      ],
      executionSummary: {
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    },
  });

  assert.ok(copy.errorMessage.includes("1"));
  assert.equal(copy.errorMessage.includes("   "), false);
});
