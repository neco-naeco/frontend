import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMissionExecutionResult,
  loadMissionResultSession,
  saveMissionResultSession,
} from "../../src/features/game-result/missionResultModel.ts";

function createStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createBackendMissionResult(overrides = {}) {
  return {
    missionId: "mission-1",
    isMissionCleared: false,
    judgeStatus: "FAILED",
    strikeCount: 3,
    remainingStrikeCount: 0,
    feedbackMessage: "failed",
    detectedIssues: [],
    executionSummary: {
      status: "FAILED",
      exitCode: 1,
      stdout: "",
      stderr: "failed",
    },
    ...overrides,
  };
}

test("formatMissionExecutionResult tolerates backend results without legacy outputs", () => {
  assert.equal(formatMissionExecutionResult(createBackendMissionResult()), null);
});

test("formatMissionExecutionResult uses backend execution stdout for success", () => {
  const result = createBackendMissionResult({
    isMissionCleared: true,
    judgeStatus: "PASSED",
    executionSummary: {
      status: "SUCCESS",
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    },
  });

  assert.equal(formatMissionExecutionResult(result), "42");
});

test("formatMissionExecutionResult preserves a legacy scalar string", () => {
  const result = createBackendMissionResult({ actualOutputs: ["42"] });

  assert.equal(formatMissionExecutionResult(result), "42");
});

test("mission result session restores the realtime result after a refresh", () => {
  const storage = createStorage();
  const result = createBackendMissionResult();

  saveMissionResultSession("room-1", result, storage);

  assert.deepEqual(loadMissionResultSession("room-1", storage), result);
  assert.equal(loadMissionResultSession("room-2", storage), null);
});
