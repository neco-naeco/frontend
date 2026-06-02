import type {
  GameState,
  MissionState,
  MissionStep,
  RoomWaitingParticipant,
  TurnEvaluationResult,
} from "../../shared/types/domain";

export type MissionFileTab = {
  filePath: string;
  fileName: string;
  language: string;
  readonly: boolean;
};

export type RoomParticipantRow = {
  userId: string;
  nickname: string;
  isCurrentUser: boolean;
  isCurrentTurn: boolean;
  roleLabel: string | null;
};

export type StrikeHeartDisplay = {
  remaining: number;
  lost: number;
};

export type MissionDisplayCopy = {
  title: string;
  description: string;
};

export type MissionProgressStep = {
  key: string;
  stepOrder: number;
  title: string;
  description: string;
  status: MissionStep["status"] | MissionState["currentStepStatus"];
  isActive: boolean;
};

export type EvaluationDisplayCopy = {
  statusLabel: string;
  analysisNotice: string;
  feedbackMessage: string;
  errorMessage: string;
};

export function getMissionFileName(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

export function buildMissionFileTabs(
  missionState: MissionState | null,
  editorFiles: Record<string, string>,
): MissionFileTab[] {
  const projectFiles = missionState?.projectStructure?.files ?? [];

  if (projectFiles.length > 0) {
    return projectFiles.map((file) => ({
      filePath: file.filePath,
      fileName: getMissionFileName(file.filePath),
      language: file.language,
      readonly: file.readonly,
    }));
  }

  return Object.keys(editorFiles).map((filePath) => ({
    filePath,
    fileName: getMissionFileName(filePath),
    language: missionState?.language ?? "text",
    readonly: false,
  }));
}

export function resolveActiveFilePath(
  activeFilePath: string | null,
  tabs: MissionFileTab[],
) {
  if (activeFilePath && tabs.some((tab) => tab.filePath === activeFilePath)) {
    return activeFilePath;
  }

  return tabs[0]?.filePath ?? null;
}

export function findMissionFileTab(
  tabs: MissionFileTab[],
  filePath: string | null | undefined,
) {
  if (!filePath) {
    return undefined;
  }

  return tabs.find((tab) => tab.filePath === filePath);
}

export function canMutateMissionFile(
  canEditTurn: boolean,
  tab: MissionFileTab | undefined,
) {
  if (!canEditTurn || !tab) {
    return false;
  }

  return !tab.readonly;
}

export function isEditorContentReadOnly(input: {
  canEditTurn: boolean;
  tab: MissionFileTab | undefined;
  isTurnExpired: boolean;
  isMissionGuideOpen: boolean;
  isRealtimeUnavailable: boolean;
}) {
  if (
    input.isRealtimeUnavailable ||
    input.isMissionGuideOpen ||
    input.isTurnExpired ||
    !input.canEditTurn
  ) {
    return true;
  }

  return Boolean(input.tab?.readonly);
}

export function canEditGameplay(
  authUserId: string | null | undefined,
  gameState: GameState | null,
) {
  const turnState = gameState?.turnState;

  if (!authUserId || !turnState) {
    return false;
  }

  return (
    turnState.currentPlayerId === authUserId &&
    turnState.status === "IN_PROGRESS"
  );
}

export function computeRemainingSeconds(
  deadlineAt: string | undefined,
  now = Date.now(),
  extraMilliseconds = 0,
) {
  if (!deadlineAt) {
    return 0;
  }

  const deadlineMs = Date.parse(deadlineAt);

  if (Number.isNaN(deadlineMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((deadlineMs + extraMilliseconds - now) / 1000));
}

export function formatTurnTimerText(remainingSeconds: number) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;
}

export function buildStrikeHeartDisplay(
  strikeCount: number | undefined,
  maxStrikeCount: number | undefined,
): StrikeHeartDisplay {
  const max = Math.max(0, maxStrikeCount ?? 0);
  const used = Math.min(Math.max(0, strikeCount ?? 0), max);
  const remaining = Math.max(0, max - used);

  return {
    remaining,
    lost: used,
  };
}

export function getLanguageDisplayLabel(language: string | undefined) {
  if (!language) {
    return null;
  }

  const normalized = language.trim().toLowerCase();

  if (normalized === "python") {
    return "🐍 Python";
  }

  return language;
}

export function buildParticipantRows(
  participants: RoomWaitingParticipant[],
  currentPlayerId: string | undefined,
  authUserId: string | null | undefined,
): RoomParticipantRow[] {
  return participants
    .filter((participant) => participant.membershipStatus === "JOINED")
    .map((participant) => ({
      userId: participant.userId,
      nickname: participant.nickname,
      isCurrentUser: participant.userId === authUserId,
      isCurrentTurn: participant.userId === currentPlayerId,
      roleLabel: participant.role === "OWNER" ? "방장" : null,
    }));
}

export function getMissionDisplayCopy(
  missionState: MissionState | null,
): MissionDisplayCopy {
  const title = missionState?.title?.trim();
  const description = missionState?.description?.trim();

  return {
    title: title || "미션 정보를 불러오는 중입니다.",
    description:
      description ||
      (missionState
        ? "미션 설명이 아직 도착하지 않았습니다."
        : "실시간 미션 데이터가 연결되면 설명이 표시됩니다."),
  };
}

export function buildMissionProgressSteps(
  missionState: MissionState | null,
): MissionProgressStep[] {
  const listedSteps = missionState?.steps ?? [];

  if (listedSteps.length > 0) {
    return listedSteps.map((step) => ({
      key: step.gameRoomMissionStepId || `${step.stepOrder}`,
      stepOrder: step.stepOrder,
      title: step.title || `Step ${step.stepOrder}`,
      description: step.description || "Step description is not available yet.",
      status: step.status,
      isActive: step.gameRoomMissionStepId === missionState?.gameRoomMissionStepId,
    }));
  }

  if (!missionState) {
    return [];
  }

  return [
    {
      key: missionState.currentStepId ?? missionState.missionId,
      stepOrder: missionState.stepOrder ?? 1,
      title: missionState.stepTitle?.trim() || missionState.title?.trim() || "Current step",
      description:
        missionState.stepDescription?.trim() ||
        missionState.description?.trim() ||
        "Step description is not available yet.",
      status: missionState.currentStepStatus,
      isActive: true,
    },
  ];
}

export function getCurrentTurnParticipantLabel(
  participantRows: RoomParticipantRow[],
) {
  const currentTurnParticipant = participantRows.find(
    (participant) => participant.isCurrentTurn,
  );

  if (!currentTurnParticipant) {
    return "현재 턴 정보를 기다리는 중";
  }

  return currentTurnParticipant.isCurrentUser
    ? "현재 턴: 나"
    : `현재 턴: ${currentTurnParticipant.nickname}`;
}

export function getEvaluationDisplayCopy(input: {
  evaluation: TurnEvaluationResult | null;
  turnSubmissionPending: boolean;
}): EvaluationDisplayCopy {
  const evaluation = input.evaluation;
  const feedbackMessage = evaluation?.feedbackMessage?.trim();
  const detectedIssues = evaluation?.detectedIssues ?? [];

  if (input.turnSubmissionPending && !evaluation) {
    return {
      statusLabel: "평가 대기",
      analysisNotice: "AI 마스터가 제출한 코드를 분석 중입니다.",
      feedbackMessage: "평가 메시지가 도착하면 이곳에 바로 반영됩니다.",
      errorMessage: "오류 분석 결과를 기다리는 중입니다.",
    };
  }

  if (!evaluation) {
    return {
      statusLabel: "대기 중",
      analysisNotice: "턴 제출 후 평가 결과가 이 영역에 표시됩니다.",
      feedbackMessage: "턴 평가가 도착하면 피드백이 이 영역에 표시됩니다.",
      errorMessage: "감지된 이슈가 있으면 평가 이벤트와 함께 표시됩니다.",
    };
  }

  const firstIssueMessage = detectedIssues[0]?.message?.trim();
  const issueCount = detectedIssues.length;

  return {
    statusLabel: evaluation.judgeStatus === "PASSED" ? "평가 완료" : "재검토 필요",
    analysisNotice: feedbackMessage || "AI 평가 결과가 도착했습니다.",
    feedbackMessage: feedbackMessage || "AI 평가 결과가 도착했습니다.",
    errorMessage:
      issueCount > 0
        ? `${issueCount}개 이슈 감지${firstIssueMessage ? ` · ${firstIssueMessage}` : ""}`
        : "감지된 오류 없이 평가가 완료되었습니다.",
  };
}

export function getMissionStepStatusLabel(
  status: MissionState["currentStepStatus"] | undefined,
) {
  switch (status) {
    case "LOCKED":
      return "잠김";
    case "READY":
      return "준비됨";
    case "IN_PROGRESS":
      return "진행 중";
    case "CLEARED":
      return "완료";
    case "FAILED":
      return "실패";
    default:
      return "대기 중";
  }
}
