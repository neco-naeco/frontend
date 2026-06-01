export type CalculatorMissionStep = {
  id: number;
  title: string;
  description: string;
};

export type ResolveMissionTurnInput = {
  completed: boolean;
  currentStepIndex: number;
  currentTurnIndex: number;
  participantCount: number;
  remainingLives: number;
};

export type MissionTurnOutcome = {
  result: "continue" | "success" | "failure";
  nextStepIndex: number;
  nextTurnIndex: number;
  remainingLives: number;
};

export const calculatorMissionSteps: CalculatorMissionStep[] = [
  {
    id: 1,
    title: "숫자 입력 받기",
    description: "input()으로 계산할 숫자 두 개를 입력받습니다.",
  },
  {
    id: 2,
    title: "정수로 변환하기",
    description: "입력받은 두 값을 int()로 변환합니다.",
  },
  {
    id: 3,
    title: "연산자 입력 받기",
    description: "input()으로 사칙연산 기호를 입력받습니다.",
  },
  {
    id: 4,
    title: "사칙연산 처리하기",
    description: "연산자에 따라 덧셈, 뺄셈, 곱셈, 나눗셈을 처리합니다.",
  },
  {
    id: 5,
    title: "결과 출력하기",
    description: "print()로 계산 결과를 출력합니다.",
  },
];

export const calculatorMissionStepSnippets = [
  "a = input()\nb = input()",
  "a = int(a)\nb = int(b)",
  "op = input()",
  [
    "if op == '+':",
    "    result = a + b",
    "elif op == '-':",
    "    result = a - b",
    "elif op == '*':",
    "    result = a * b",
    "elif op == '/':",
    "    result = a / b",
  ].join("\n"),
  "print(result)",
];

export function buildCompletedCalculatorCode(completedStepCount: number) {
  return calculatorMissionStepSnippets
    .slice(0, completedStepCount)
    .join("\n\n");
}

export function buildCalculatorTypingFrame(
  existingCode: string,
  stepIndex: number,
  typedCharacterCount: number,
) {
  const snippet = calculatorMissionStepSnippets[stepIndex] ?? "";
  const separator = existingCode.trim().length > 0 ? "\n\n" : "";

  return `${existingCode}${`${separator}${snippet}`.slice(0, typedCharacterCount)}`;
}

const stepValidators: Array<(code: string) => boolean> = [
  (code) =>
    /^\s*a\s*=\s*input\s*\(\s*\)\s*$/m.test(code) &&
    /^\s*b\s*=\s*input\s*\(\s*\)\s*$/m.test(code),
  (code) =>
    /^\s*a\s*=\s*int\s*\(\s*a\s*\)\s*$/m.test(code) &&
    /^\s*b\s*=\s*int\s*\(\s*b\s*\)\s*$/m.test(code),
  (code) => /^\s*op\s*=\s*input\s*\(\s*\)\s*$/m.test(code),
  (code) =>
    /^\s*if\s+op\s*==\s*['"]\+['"]\s*:/m.test(code) &&
    /^\s*result\s*=\s*a\s*\+\s*b\s*$/m.test(code) &&
    /^\s*elif\s+op\s*==\s*['"]-['"]\s*:/m.test(code) &&
    /^\s*result\s*=\s*a\s*-\s*b\s*$/m.test(code) &&
    /^\s*elif\s+op\s*==\s*['"]\*['"]\s*:/m.test(code) &&
    /^\s*result\s*=\s*a\s*\*\s*b\s*$/m.test(code) &&
    /^\s*elif\s+op\s*==\s*['"]\/['"]\s*:/m.test(code) &&
    /^\s*result\s*=\s*a\s*\/\s*b\s*$/m.test(code),
  (code) => /^\s*print\s*\(\s*result\s*\)\s*$/m.test(code),
];

export function isCalculatorStepComplete(stepIndex: number, code: string) {
  return stepValidators[stepIndex]?.(code) ?? false;
}

export function resolveMissionTurn({
  completed,
  currentStepIndex,
  currentTurnIndex,
  participantCount,
  remainingLives,
}: ResolveMissionTurnInput): MissionTurnOutcome {
  if (completed) {
    if (currentStepIndex === calculatorMissionSteps.length - 1) {
      return {
        result: "success",
        nextStepIndex: currentStepIndex,
        nextTurnIndex: currentTurnIndex,
        remainingLives,
      };
    }

    return {
      result: "continue",
      nextStepIndex: currentStepIndex + 1,
      nextTurnIndex: (currentTurnIndex + 1) % participantCount,
      remainingLives,
    };
  }

  const nextLives = Math.max(0, remainingLives - 1);

  return {
    result: nextLives === 0 ? "failure" : "continue",
    nextStepIndex: currentStepIndex,
    nextTurnIndex:
      nextLives === 0
        ? currentTurnIndex
        : (currentTurnIndex + 1) % participantCount,
    remainingLives: nextLives,
  };
}
