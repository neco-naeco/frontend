import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalculatorTypingFrame,
  buildCompletedCalculatorCode,
  calculatorMissionStepSnippets,
  isCalculatorStepComplete,
  resolveMissionTurn,
} from "../../src/pages/RoomPage/missionProgress.ts";

test("calculator mission validates each cumulative implementation step", () => {
  const code = [
    "a = input()",
    "b = input()",
    "a = int(a)",
    "b = int(b)",
    "op = input()",
    "if op == '+':",
    "    result = a + b",
    "elif op == '-':",
    "    result = a - b",
    "elif op == '*':",
    "    result = a * b",
    "elif op == '/':",
    "    result = a / b",
    "print(result)",
  ].join("\n");

  assert.equal(isCalculatorStepComplete(0, code), true);
  assert.equal(isCalculatorStepComplete(1, code), true);
  assert.equal(isCalculatorStepComplete(2, code), true);
  assert.equal(isCalculatorStepComplete(3, code), true);
  assert.equal(isCalculatorStepComplete(4, code), true);
});

test("scripted calculator relay snippets cumulatively complete every step", () => {
  let code = "";

  calculatorMissionStepSnippets.forEach((snippet, stepIndex) => {
    assert.equal(snippet.includes("#"), false);
    code = code ? `${code}\n\n${snippet}` : snippet;

    assert.equal(isCalculatorStepComplete(stepIndex, code), true);
  });
});

test("failed scripted relay clears only the unfinished step code", () => {
  assert.equal(buildCompletedCalculatorCode(0), "");
  assert.equal(
    buildCompletedCalculatorCode(2),
    ["a = input()", "b = input()", "", "a = int(a)", "b = int(b)"].join(
      "\n",
    ),
  );
});

test("scripted typing preserves completed code and reveals only the next step", () => {
  const existingCode = buildCompletedCalculatorCode(1);

  assert.equal(
    buildCalculatorTypingFrame(existingCode, 1, 5),
    `${existingCode}\n\na =`,
  );
  assert.equal(
    buildCalculatorTypingFrame(existingCode, 1, Number.POSITIVE_INFINITY),
    `${existingCode}\n\na = int(a)\nb = int(b)`,
  );
});

test("successful step submission advances the step and the current writer", () => {
  assert.deepEqual(
    resolveMissionTurn({
      completed: true,
      currentStepIndex: 0,
      currentTurnIndex: 0,
      participantCount: 5,
      remainingLives: 3,
    }),
    {
      result: "continue",
      nextStepIndex: 1,
      nextTurnIndex: 1,
      remainingLives: 3,
    },
  );
});

test("failed or expired step keeps the step active for the next writer", () => {
  assert.deepEqual(
    resolveMissionTurn({
      completed: false,
      currentStepIndex: 2,
      currentTurnIndex: 1,
      participantCount: 5,
      remainingLives: 3,
    }),
    {
      result: "continue",
      nextStepIndex: 2,
      nextTurnIndex: 2,
      remainingLives: 2,
    },
  );
});

test("last failed life ends the mission without advancing the writer", () => {
  assert.deepEqual(
    resolveMissionTurn({
      completed: false,
      currentStepIndex: 2,
      currentTurnIndex: 1,
      participantCount: 5,
      remainingLives: 1,
    }),
    {
      result: "failure",
      nextStepIndex: 2,
      nextTurnIndex: 1,
      remainingLives: 0,
    },
  );
});

test("final completed step ends the calculator mission successfully", () => {
  assert.equal(
    resolveMissionTurn({
      completed: true,
      currentStepIndex: 4,
      currentTurnIndex: 3,
      participantCount: 5,
      remainingLives: 2,
    }).result,
    "success",
  );
});
