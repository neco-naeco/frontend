export type AiChatSessionStatus = "ACTIVE" | "CLOSED" | "ERROR";

export type AiChatRequestType =
  | "ROOM_CREATE"
  | "USER_INVITE"
  | "ROOM_JOIN"
  | "USER_INVITE_DENY"
  | "GAME_START";

export type AiChatRequestStatus = "RECEIVED" | "COMPLETED" | "FAILED";

export type AiChatMessageSenderType = "USER" | "ASSISTANT" | "SYSTEM";

export type AiChatMessageType = "TEXT" | "COMMAND_RESULT" | "SYSTEM_NOTICE";

export type MissionDifficulty = "EASY" | "NORMAL" | "HARD";

export type RoomCommandStatus = "PENDING" | "SUCCESS" | "FAILED";

export type GameRoomStatus =
  | "WAITING"
  | "IN_PROGRESS"
  | "JUDGING"
  | "ANALYZED"
  | "FINISHED";

export type MembershipStatus = "INVITED" | "JOINED" | "LEFT" | "DENIED";

export type ParticipantRole = "OWNER" | "PARTICIPANT";

export type TurnStatus = "IN_PROGRESS" | "SUBMITTED" | "TIMEOUT";

export type ExecutionStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "TIMEOUT";

export type GameRoomMissionStepStatus =
  | "LOCKED"
  | "READY"
  | "IN_PROGRESS"
  | "CLEARED"
  | "FAILED";

export type PresenceStatus = "ONLINE" | "OFFLINE" | "ACTIVE" | "IDLE";

export type AuthUser = {
  userId: string;
  loginId: string;
  nickname: string;
  email: string | null;
};

export type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
};

export type CheckNicknameResponse = {
  isAvailable: boolean;
};

export type SignupRequest = {
  loginId: string;
  nickname: string;
  passwordHash: string;
  email?: string | null;
};

export type SignupResponse = {
  userId: string;
  loginId: string;
  nickname: string;
  email: string | null;
  createdAt: string;
};

export type LoginRequest = {
  loginId: string;
  passwordHash: string;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type RefreshTokenRequest = {
  refreshToken: string;
};

export type RefreshTokenResponse = {
  accessToken: string;
};

export type CurrentGameRoom = {
  gameRoomId: string;
  status: GameRoomStatus;
  difficulty: MissionDifficulty;
  ownerUserId: string;
  myRole: ParticipantRole;
  myMembershipStatus: MembershipStatus;
  joinedParticipantCount: number;
  timeLimitSeconds: number;
  maxStrikeCount: number;
  minParticipants: number;
  maxParticipants: number;
  createdAt: string;
  updatedAt: string;
};

export type CurrentGameRoomState = {
  currentRoom: CurrentGameRoom | null;
  duplicateRoomWarning: boolean;
};

export type StartGameRequest = {
  missionTemplateId: string;
};

export type StartGameResponse = {
  success: boolean;
};

export type GameRoomParticipant = {
  participantId: string;
  gameRoomId: string;
  userId: string;
  nickname: string;
  role: ParticipantRole;
  membershipStatus: MembershipStatus;
  roomStatus: GameRoomStatus;
  createdAt: string;
};

export type AiChatSession = {
  aiChatSessionId: string;
  requesterUserId: string;
  gameRoomId: string | null;
  status: AiChatSessionStatus;
  provider: string;
  llmModel: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type AiChatMessage = {
  messageId: string;
  aiChatRequestId: string | null;
  senderType: AiChatMessageSenderType;
  messageType: AiChatMessageType;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type SendAiChatMessageRequest = {
  message: string;
};

export type AiChatCommandResult = {
  commandType: AiChatRequestType;
  status: RoomCommandStatus;
  apiPath: string | null;
  gameRoomId: string | null;
  participants: string[] | null;
  started: boolean | null;
};

export type SendAiChatMessageResponse = {
  aiChatRequestId: string;
  requestType: AiChatRequestType;
  requestStatus: AiChatRequestStatus;
  userMessage?: AiChatMessage;
  assistantMessage?: AiChatMessage;
  commandResult: AiChatCommandResult | null;
};

export type RoomWaitingParticipant = {
  userId: string;
  nickname: string;
  role: ParticipantRole;
  membershipStatus: MembershipStatus;
};

export type GameState = {
  status: GameRoomStatus;
  difficulty?: MissionDifficulty;
  timeLimitSeconds?: number;
  minParticipants?: number;
  maxParticipants?: number;
  strikeCount?: number;
  maxStrikeCount?: number;
  turnState?: TurnState;
};

export type TurnState = {
  turnId: string;
  turnNumber: number;
  currentPlayerId: string;
  startedAt: string;
  deadlineAt: string;
  timeLimitSeconds: number;
  remainingTimeSeconds: number;
  status: TurnStatus;
};

export type MissionProjectFile = {
  filePath: string;
  language: string;
  readonly: boolean;
  /** Current backend payloads may include inline starter or authoritative content. */
  content?: string;
  /** Some backend flows materialize file content as a URL instead of inline text. */
  fileUrl?: string;
};

export type MissionProjectStructure = {
  rootPath: string;
  entryFilePath: string;
  files: MissionProjectFile[];
};

export type MissionStep = {
  gameRoomMissionStepId: string;
  missionTemplateStepId: string;
  stepOrder: number;
  title: string;
  description: string;
  status: GameRoomMissionStepStatus;
  targetFilePath?: string;
};

export type MissionState = {
  missionId: string;
  missionTemplateId?: string;
  currentStepId?: string;
  currentStepStatus?: GameRoomMissionStepStatus;
  gameRoomMissionStepId?: string;
  missionTemplateStepId?: string;
  title?: string;
  description?: string;
  language?: string;
  difficulty?: MissionDifficulty;
  strikeCount?: number;
  status?: string;
  stepOrder?: number | null;
  stepTitle?: string;
  stepDescription?: string;
  steps?: MissionStep[];
  projectStructure?: MissionProjectStructure;
};

export type RoomWaitingState = {
  currentRoom: CurrentGameRoom;
  participants: RoomWaitingParticipant[];
  changedParticipant: RoomWaitingParticipant | null;
  gameState: GameState;
  missionState: MissionState | null;
};

export type CodeSnapshot = {
  files: CodeSnapshotFile[];
};

export type CodeSnapshotFile = {
  filePath: string;
  content: string;
};

export type CodeDelta = Record<string, unknown>;

export type JoinRoomEvent = {
  accessToken: string;
  gameRoomId: string;
  userId: string;
};

export type CodeChangeEvent = {
  gameRoomId: string;
  userId?: string;
  sessionId?: string;
  filePath: string;
  /** Legacy/frontend-planned delta payload kept optional while backend remains content-based. */
  codeDelta?: CodeDelta;
  /** Current backend contract accepts full-file content for realtime sync. */
  content?: string;
  occurredAt?: string;
};

export type CodeUpdatedEvent = {
  gameRoomId: string;
  userId: string;
  /** When present, compare to `realtime.socketId` for same-client echo suppression only. */
  sessionId?: string;
  filePath: string;
  /** Legacy/frontend-planned delta payload kept optional while backend remains content-based. */
  codeDelta?: CodeDelta;
  /** Optional full-file payload for authoritative baseline seeding (not required on every event). */
  content?: string;
  occurredAt: string;
};

export type TurnSubmitFilePayload = {
  filePath: string;
  content: string;
};

export type TurnSubmitEvent = {
  gameRoomId: string;
  /** Present in the current frontend submit path but not required by the backend runtime contract. */
  userId?: string;
  /** Present in the current frontend submit path but the backend can derive it from support state. */
  turnId?: string;
  /** Planned/documented snapshot shape retained for compatibility with existing frontend code. */
  codeSnapshot?: CodeSnapshot;
  /** Current backend runtime contract accepts flattened file payloads. */
  files?: TurnSubmitFilePayload[];
  submittedAt?: string;
  occurredAt?: string;
};

export type RoomParticipantsUpdatedEvent = {
  gameRoomId: string;
  participants: RoomWaitingParticipant[];
  changedParticipant: RoomWaitingParticipant | null;
  gameState: GameState;
  missionState: MissionState | null;
  occurredAt: string;
};

export type GameStartedUiHints = {
  enterGameScreen: boolean;
  showMissionGuideModal: boolean;
};

export type GameStartedEvent = {
  gameRoomId: string;
  gameState: GameState;
  missionState: MissionState;
  uiHints: GameStartedUiHints;
  occurredAt: string;
};

export type DetectedIssue = {
  issueType: string;
  message: string;
  filePath: string | null;
  lineNumber?: number;
  caseName?: string;
};

export type TurnEvaluationResult = {
  isStepCleared: boolean;
  isMissionCleared?: boolean;
  judgeStatus: string;
  missionId?: string;
  turnId?: string;
  stepId?: string | null;
  stepOrder?: number | null;
  strikeCount: number;
  remainingStrikeCount: number;
  feedbackMessage: string;
  detectedIssues: DetectedIssue[];
  stepJudgingSummary?: {
    totalCases: number;
    passedCount: number;
    failedCount: number;
    errorCount: number;
  } | null;
  publicCaseResults?: unknown[] | null;
  executionSummary: {
    status: ExecutionStatus;
    exitCode: number;
    stdout: string;
    stderr: string;
    runtimeFailureCode?: string | null;
    runtimeFailureMessage?: string | null;
  };
};

export type EvaluatedTurn = {
  turnId: string;
  turnNumber: number;
  playerUserId: string;
  status: TurnStatus;
};

export type TurnEvaluatedEvent = {
  gameRoomId: string;
  evaluatedTurn: EvaluatedTurn;
  evaluationResult: TurnEvaluationResult;
  occurredAt: string;
};

export type TurnChangedEvent = {
  gameRoomId: string;
  missionState?: MissionState | null;
  turnState?: TurnState | null;
  nextPlayerId?: string | null;
  turnSnapshotId?: string | null;
  previousTurnId?: string | null;
  currentTurnId?: string | null;
  currentTurnUserId?: string | null;
  occurredAt?: string;
};

export type GameStateUpdatedEvent = {
  gameRoomId: string;
  gameState: GameState;
  missionState?: MissionState | null;
  occurredAt?: string;
};

export type MissionResult = {
  missionId: string;
  isMissionCleared: boolean;
  judgeStatus: string;
  selectedInputs?: unknown[];
  expectedOutputs?: unknown[];
  actualOutputs?: unknown[];
  strikeCount: number;
  remainingStrikeCount: number;
  feedbackMessage: string;
  detectedIssues: DetectedIssue[];
  executionSummary?: TurnEvaluationResult["executionSummary"];
};

export type MissionResultEvent = {
  gameRoomId: string;
  gameState?: GameState;
  missionResult: MissionResult;
  occurredAt?: string;
};

export type HintResponse = {
  missionId: string;
  gameRoomMissionStepId: string | null;
  missionTemplateStepId: string;
  hintText: string | null;
};
