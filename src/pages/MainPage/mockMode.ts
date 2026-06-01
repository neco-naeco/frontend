import type {
  AiChatMessage,
  AiChatSession,
  CurrentGameRoom,
  GameRoomParticipant,
  SendAiChatMessageResponse,
} from "../../shared/types/domain";

export const MAIN_PAGE_MOCK_PARAM = "mock";
export const PRESENTATION_MOCK_STORAGE_KEY = "neconaeco:presentation-guest-joined";
export const PRESENTATION_INVITES_STORAGE_KEY = "neconaeco:presentation-invitees";

export type MainPageMockScenario =
  | "room-create"
  | "room-create-delay"
  | "invitation"
  | "invitation-delay"
  | "start-ready"
  | "presentation-owner"
  | "presentation-guest";

export const MAIN_PAGE_MOCK_USER = {
  userId: "mock-user-1",
  loginId: "mock-user",
  nickname: "목플레이어",
  email: "mock@example.com",
};

const PRESENTATION_OWNER_USER = {
  userId: "presentation-owner",
  loginId: "hyeonha",
  nickname: "현하",
  email: "hyeonha@example.com",
};

const PRESENTATION_GUEST_USERS = [
  ["presentation-guest-seongmin", "seongmin", "성민"],
  ["presentation-guest-suhyeon", "suhyeon", "수현"],
  ["presentation-guest-hyeon", "hyeon", "현"],
  ["presentation-guest-jeonghwa", "jeonghwa", "정화"],
].map(([userId, loginId, nickname]) => ({
  userId,
  loginId,
  nickname,
  email: `${loginId}@example.com`,
}));

const DEFAULT_PRESENTATION_GUEST_NICKNAME = "성민";

type MockRoomCreateStep =
  | "idle"
  | "waiting-difficulty"
  | "waiting-template"
  | "room-created";

type MockMainPageState = {
  scenario: MainPageMockScenario;
  step: MockRoomCreateStep;
  session: AiChatSession;
  messages: AiChatMessage[];
  currentRoom: CurrentGameRoom | null;
  invitations: GameRoomParticipant[];
  roomParticipants: GameRoomParticipant[];
  currentRoomSyncLag: number;
  currentTemplates: Array<{
    templateId: string;
    title: string;
    description: string;
    difficulty: "EASY" | "NORMAL" | "HARD";
  }>;
};

const mockStates = new Map<string, MockMainPageState>();
let mockInstanceCounter = 0;

function isMainPageMockScenario(value: string | null): value is MainPageMockScenario {
  return (
    value === "room-create" ||
    value === "room-create-delay" ||
    value === "invitation" ||
    value === "invitation-delay" ||
    value === "start-ready" ||
    value === "presentation-owner" ||
    value === "presentation-guest"
  );
}

export function isPresentationMockScenario(scenario: string | null) {
  return scenario === "presentation-owner" || scenario === "presentation-guest";
}

function getPresentationGuestUser(nickname = DEFAULT_PRESENTATION_GUEST_NICKNAME) {
  return (
    PRESENTATION_GUEST_USERS.find((user) => user.nickname === nickname) ??
    PRESENTATION_GUEST_USERS[0]
  );
}

export function getMainPageMockUser(
  scenario: MainPageMockScenario,
  presentationGuestNickname?: string,
) {
  if (scenario === "presentation-owner") {
    return PRESENTATION_OWNER_USER;
  }

  if (scenario === "presentation-guest") {
    return getPresentationGuestUser(presentationGuestNickname);
  }

  return MAIN_PAGE_MOCK_USER;
}

function createIsoTimestamp(offsetMinutes: number) {
  const baseTime = Date.parse("2026-05-25T12:00:00+09:00");

  return new Date(baseTime + offsetMinutes * 60_000).toISOString();
}

function createMockSession(
  gameRoomId: string | null = null,
  user = MAIN_PAGE_MOCK_USER,
): AiChatSession {
  return {
    aiChatSessionId: "mock-session-room-create",
    requesterUserId: user.userId,
    gameRoomId,
    status: "ACTIVE",
    provider: "openai",
    llmModel: "gpt-5.4",
    createdAt: createIsoTimestamp(0),
    updatedAt: createIsoTimestamp(0),
    closedAt: null,
  };
}

function createMessage({
  messageId,
  aiChatRequestId,
  senderType,
  messageType,
  content,
  metadata,
  createdAt,
}: {
  messageId: string;
  aiChatRequestId: string | null;
  senderType: AiChatMessage["senderType"];
  messageType: AiChatMessage["messageType"];
  content: string;
  metadata?: AiChatMessage["metadata"];
  createdAt: string;
}): AiChatMessage {
  return {
    messageId,
    aiChatRequestId,
    senderType,
    messageType,
    content,
    metadata: metadata ?? null,
    createdAt,
  };
}

function createWelcomeMessage() {
  return createMessage({
    messageId: "mock-message-welcome",
    aiChatRequestId: null,
    senderType: "ASSISTANT",
    messageType: "TEXT",
    content:
      "안녕하세요! AI 마스터입니다. 😄\n네코내코에 오신 것을 환영해요!\n\n현재 참여하고있는 방이 없어요.\n방을 만들고 친구를 초대해보세요!",
    createdAt: createIsoTimestamp(1),
  });
}

function createInvitationWelcomeMessage() {
  return createMessage({
    messageId: "mock-message-invitation-welcome",
    aiChatRequestId: null,
    senderType: "ASSISTANT",
    messageType: "TEXT",
    content:
      "목데이터 모드예요. 도착한 초대장을 카드에서 바로 수락하거나 거절해보세요.",
    createdAt: createIsoTimestamp(1),
  });
}

function createPresentationGuestWelcomeMessage() {
  return createMessage({
    messageId: "presentation-guest-welcome",
    aiChatRequestId: null,
    senderType: "ASSISTANT",
    messageType: "TEXT",
    content:
      "안녕하세요! AI 마스터입니다. 😄\n네코내코에 오신 것을 환영해요!\n\n현재 참여하고있는 방이 없어요.\n방을 만들고 친구를 초대해보세요!",
    createdAt: createIsoTimestamp(1),
  });
}

function createPresentationGuestInvitationMessage(guestNickname: string) {
  return createMessage({
    messageId: `presentation-guest-invitation-arrived-${guestNickname}`,
    aiChatRequestId: null,
    senderType: "ASSISTANT",
    messageType: "SYSTEM_NOTICE",
    content: "현하님이 문자열 핸들링 릴레이 방에 초대했어요. 아래 초대장을 확인해주세요.",
    createdAt: createIsoTimestamp(2),
  });
}

function createStartReadyWelcomeMessage() {
  return createMessage({
    messageId: "mock-message-start-ready-welcome",
    aiChatRequestId: null,
    senderType: "ASSISTANT",
    messageType: "TEXT",
    content:
      "목데이터 모드예요. 이미 대기방 인원 조건을 만족한 상태라서 방장이 바로 게임 시작 요청을 눌러볼 수 있어요.",
    createdAt: createIsoTimestamp(1),
  });
}

function createCurrentRoom(): CurrentGameRoom {
  return {
    gameRoomId: "mock-room-1",
    title: "기초 산술 연산 릴레이 방",
    status: "WAITING",
    ownerUserId: MAIN_PAGE_MOCK_USER.userId,
    myRole: "OWNER",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 1,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: createIsoTimestamp(8),
    updatedAt: createIsoTimestamp(8),
  };
}

function createPresentationOwnerRoom(): CurrentGameRoom {
  return {
    ...createCurrentRoom(),
    gameRoomId: "presentation-room-1",
    title: "문자열 핸들링 릴레이 방",
    ownerUserId: PRESENTATION_OWNER_USER.userId,
    myRole: "OWNER",
    joinedParticipantCount: 1,
    maxParticipants: 5,
  };
}

function createPresentationGuestRoom(): CurrentGameRoom {
  return {
    ...createPresentationOwnerRoom(),
    myRole: "PARTICIPANT",
    joinedParticipantCount: 1 + getPresentationJoinedGuestNicknames().length,
  };
}

function createStartReadyRoom(): CurrentGameRoom {
  return {
    gameRoomId: "mock-start-ready-room-1",
    title: "배열 누적합 릴레이 방",
    status: "WAITING",
    ownerUserId: MAIN_PAGE_MOCK_USER.userId,
    myRole: "OWNER",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 2,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: createIsoTimestamp(8),
    updatedAt: createIsoTimestamp(8),
  };
}

function createJoinedInvitationRoom(): CurrentGameRoom {
  return {
    gameRoomId: "mock-invitation-room-1",
    title: "문자열 핸들링 릴레이 방",
    status: "WAITING",
    ownerUserId: "mock-owner-1",
    myRole: "PARTICIPANT",
    myMembershipStatus: "JOINED",
    joinedParticipantCount: 2,
    minParticipants: 2,
    maxParticipants: 4,
    createdAt: createIsoTimestamp(4),
    updatedAt: createIsoTimestamp(6),
  };
}

function createInvitationParticipant(): GameRoomParticipant {
  return {
    participantId: "mock-invitation-participant-1",
    gameRoomId: "mock-invitation-room-1",
    gameRoomTitle: "문자열 핸들링 릴레이 방",
    userId: "mock-owner-1",
    nickname: "목방장",
    role: "OWNER",
    status: "INVITED",
    roomStatus: "WAITING",
    createdAt: createIsoTimestamp(2),
  };
}

function createPresentationInvitation(guestNickname: string): GameRoomParticipant {
  const guestUser = getPresentationGuestUser(guestNickname);

  return {
    participantId: `presentation-invitation-${guestUser.userId}`,
    gameRoomId: "presentation-room-1",
    gameRoomTitle: "문자열 핸들링 릴레이 방",
    userId: PRESENTATION_OWNER_USER.userId,
    nickname: PRESENTATION_OWNER_USER.nickname,
    role: "OWNER",
    status: "INVITED",
    roomStatus: "WAITING",
    createdAt: createIsoTimestamp(2),
  };
}

function createPresentationParticipants(
  joinedGuestNicknames = getPresentationJoinedGuestNicknames(),
): GameRoomParticipant[] {
  const room = createPresentationOwnerRoom();
  const joinedGuestUsers = joinedGuestNicknames.map(getPresentationGuestUser);

  return [
    [PRESENTATION_OWNER_USER.userId, PRESENTATION_OWNER_USER.nickname, "OWNER"],
    ...joinedGuestUsers.map((user) => [user.userId, user.nickname, "PARTICIPANT"]),
  ].map(([userId, nickname, role], index) =>
    createRoomParticipant({
      participantId: `presentation-participant-${index + 1}`,
      gameRoomId: room.gameRoomId,
      gameRoomTitle: room.title,
      userId,
      nickname,
      role: role as GameRoomParticipant["role"],
      status: "JOINED",
    }),
  );
}

function createPresentationOwnerParticipant() {
  return createPresentationParticipants()[0];
}

function getPresentationJoinedGuestNicknames() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const joinedGuestNicknames = JSON.parse(
      window.localStorage.getItem(PRESENTATION_MOCK_STORAGE_KEY) ?? "[]",
    );

    return Array.isArray(joinedGuestNicknames)
      ? joinedGuestNicknames.filter(
          (nickname): nickname is string => typeof nickname === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function setPresentationGuestJoined(guestNickname: string, hasJoined: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  const joinedGuestNicknames = getPresentationJoinedGuestNicknames().filter(
    (nickname) => nickname !== guestNickname,
  );

  if (hasJoined) {
    joinedGuestNicknames.push(guestNickname);
  }

  if (joinedGuestNicknames.length > 0) {
    window.localStorage.setItem(
      PRESENTATION_MOCK_STORAGE_KEY,
      JSON.stringify(joinedGuestNicknames),
    );
    return;
  }

  window.localStorage.removeItem(PRESENTATION_MOCK_STORAGE_KEY);
}

function getPresentationInvitees() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const invitees = JSON.parse(
      window.localStorage.getItem(PRESENTATION_INVITES_STORAGE_KEY) ?? "[]",
    );

    return Array.isArray(invitees)
      ? invitees.filter((invitee): invitee is string => typeof invitee === "string")
      : [];
  } catch {
    return [];
  }
}

function setPresentationInvitees(invitees: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  if (invitees.length > 0) {
    window.localStorage.setItem(PRESENTATION_INVITES_STORAGE_KEY, JSON.stringify(invitees));
    return;
  }

  window.localStorage.removeItem(PRESENTATION_INVITES_STORAGE_KEY);
}

function syncPresentationGuestInvitation(
  state: MockMainPageState,
  guestNickname: string,
) {
  if (
    state.scenario !== "presentation-guest" ||
    state.currentRoom ||
    state.invitations.length > 0 ||
    !getPresentationInvitees().includes(guestNickname)
  ) {
    return;
  }

  state.invitations = [createPresentationInvitation(guestNickname)];

  if (
    !state.messages.some(
      (message) =>
        message.messageId === `presentation-guest-invitation-arrived-${guestNickname}`,
    )
  ) {
    appendMessages(state, createPresentationGuestInvitationMessage(guestNickname));
  }
}

function syncPresentationOwnerGuestJoin(state: MockMainPageState) {
  const joinedGuestNicknames = getPresentationJoinedGuestNicknames();
  const newGuestNicknames = joinedGuestNicknames.filter(
    (nickname) =>
      !state.roomParticipants.some((participant) => participant.nickname === nickname),
  );

  if (
    state.scenario !== "presentation-owner" ||
    !state.currentRoom ||
    newGuestNicknames.length === 0
  ) {
    return;
  }

  const joinedAt = createIsoTimestamp(state.messages.length + 2);

  state.currentRoom = {
    ...state.currentRoom,
    joinedParticipantCount: 1 + joinedGuestNicknames.length,
    updatedAt: joinedAt,
  };
  state.roomParticipants = [
    ...createPresentationParticipants(joinedGuestNicknames),
  ];
  appendMessages(
    state,
    ...newGuestNicknames.map((nickname, index) =>
      createMessage({
        messageId: `presentation-owner-guest-joined-${nickname}`,
        aiChatRequestId: null,
        senderType: "ASSISTANT",
        messageType: "SYSTEM_NOTICE",
        content: `'${nickname}'님이 입장했습니다.${joinedGuestNicknames.length === 4 ? " 모든 참가자가 입장했어요." : ""}`,
        createdAt: createIsoTimestamp(state.messages.length + index + 2),
      }),
    ),
  );
}

function createRoomParticipant({
  participantId,
  gameRoomId,
  gameRoomTitle,
  userId,
  nickname,
  role,
  status,
}: {
  participantId: string;
  gameRoomId: string;
  gameRoomTitle: string;
  userId: string;
  nickname: string;
  role: GameRoomParticipant["role"];
  status: GameRoomParticipant["status"];
}): GameRoomParticipant {
  return {
    participantId,
    gameRoomId,
    gameRoomTitle,
    userId,
    nickname,
    role,
    status,
    roomStatus: "WAITING",
    createdAt: createIsoTimestamp(6),
  };
}

function createInitialMockState(
  scenario: MainPageMockScenario,
  presentationGuestNickname = DEFAULT_PRESENTATION_GUEST_NICKNAME,
): MockMainPageState {
  if (scenario === "presentation-guest") {
    const presentationGuestUser = getPresentationGuestUser(presentationGuestNickname);

    return {
      scenario,
      step: "idle",
      session: createMockSession(null, presentationGuestUser),
      messages: [createPresentationGuestWelcomeMessage()],
      currentRoom: null,
      invitations: [],
      roomParticipants: [],
      currentRoomSyncLag: 0,
      currentTemplates: [],
    };
  }

  if (scenario === "presentation-owner") {
    PRESENTATION_GUEST_USERS.forEach((guestUser) =>
      setPresentationGuestJoined(guestUser.nickname, false),
    );
    setPresentationInvitees([]);

    return {
      scenario,
      step: "idle",
      session: createMockSession(null, PRESENTATION_OWNER_USER),
      messages: [createWelcomeMessage()],
      currentRoom: null,
      invitations: [],
      roomParticipants: [],
      currentRoomSyncLag: 0,
      currentTemplates: [],
    };
  }

  if (scenario === "start-ready") {
    const room = createStartReadyRoom();

    return {
      scenario,
      step: "room-created",
      session: createMockSession(room.gameRoomId),
      messages: [createStartReadyWelcomeMessage()],
      currentRoom: room,
      invitations: [],
      roomParticipants: [
        createRoomParticipant({
          participantId: "mock-start-owner-participant-1",
          gameRoomId: room.gameRoomId,
          gameRoomTitle: room.title,
          userId: MAIN_PAGE_MOCK_USER.userId,
          nickname: MAIN_PAGE_MOCK_USER.nickname,
          role: "OWNER",
          status: "JOINED",
        }),
        createRoomParticipant({
          participantId: "mock-start-player-participant-1",
          gameRoomId: room.gameRoomId,
          gameRoomTitle: room.title,
          userId: "mock-teammate-1",
          nickname: "목팀원",
          role: "PARTICIPANT",
          status: "JOINED",
        }),
      ],
      currentRoomSyncLag: 0,
      currentTemplates: [],
    };
  }

  if (scenario === "invitation" || scenario === "invitation-delay") {
    return {
      scenario,
      step: "idle",
      session: createMockSession(),
      messages: [createInvitationWelcomeMessage()],
      currentRoom: null,
      invitations: [createInvitationParticipant()],
      roomParticipants: [],
      currentRoomSyncLag: 0,
      currentTemplates: [],
    };
  }

  return {
    scenario,
    step: "idle",
    session: createMockSession(),
    messages: [createWelcomeMessage()],
    currentRoom: null,
    invitations: [],
    roomParticipants: [],
    currentRoomSyncLag: 0,
    currentTemplates: [],
  };
}

function getScenarioState(
  scenario: MainPageMockScenario,
  instanceId: string,
  presentationGuestNickname?: string,
) {
  const currentState = mockStates.get(instanceId);

  if (!currentState || currentState.scenario !== scenario) {
    const initialState = createInitialMockState(scenario, presentationGuestNickname);

    mockStates.set(instanceId, initialState);
    return initialState;
  }

  return currentState;
}

function normalizeMessage(value: string) {
  return value.trim().toLowerCase();
}

function extractPresentationInvitees(message: string) {
  const inviteeText = message
    .replace(/초대\s*해줘[.!?]?/g, "")
    .replace(/초대[.!?]?/g, "")
    .trim();
  const invitees = inviteeText
    .split(/[,，]/)
    .map((nickname) => nickname.trim())
    .filter(Boolean);

  return invitees.length > 0 ? invitees : ["성민"];
}

function buildResponse({
  aiChatRequestId,
  requestType,
  requestStatus,
  userMessage,
  assistantMessage,
  commandResult,
}: SendAiChatMessageResponse) {
  return {
    aiChatRequestId,
    requestType,
    requestStatus,
    userMessage,
    assistantMessage,
    commandResult,
  };
}

function appendMessages(state: MockMainPageState, ...messages: AiChatMessage[]) {
  state.messages = [...state.messages, ...messages];

  const lastMessage = messages[messages.length - 1];

  state.session = {
    ...state.session,
    updatedAt: lastMessage.createdAt,
  };
}

function createRequestIds(step: number) {
  return {
    aiChatRequestId: `mock-request-${step}`,
    userMessageId: `mock-user-message-${step}`,
    assistantMessageId: `mock-assistant-message-${step}`,
    timestamp: createIsoTimestamp(step + 1),
  };
}

function detectDifficulty(message: string) {
  if (message.includes("easy") || message.includes("쉬운") || message.includes("쉬움")) {
    return "EASY";
  }

  if (message.includes("hard") || message.includes("어려운") || message.includes("어려움")) {
    return "HARD";
  }

  if (message.includes("normal") || message.includes("보통")) {
    return "NORMAL";
  }

  return null;
}

function getTemplatesByDifficulty(difficulty: "EASY" | "NORMAL" | "HARD") {
  switch (difficulty) {
    case "EASY":
      return [
        {
          templateId: "mock-template-easy-calculator",
          title: "표준 입력 계산기",
          description: "Python으로 표준 입력을 읽어 사칙연산 계산기를 단계별로 완성합니다.",
          difficulty,
        },
        {
          templateId: "mock-template-easy-1",
          title: "기초 산술 연산",
          description: "덧셈, 뺄셈, 곱셈, 나눗셈 중심의 입문용 문제예요.",
          difficulty,
        },
        {
          templateId: "mock-template-easy-2",
          title: "문자열 뒤집기",
          description: "기초 반복문과 문자열 처리를 익히는 미션이에요.",
          difficulty,
        },
      ];
    case "NORMAL":
      return [
        {
          templateId: "mock-template-normal-1",
          title: "배열 필터링",
          description: "조건 분기와 배열 순회를 함께 다루는 미션이에요.",
          difficulty,
        },
      ];
    case "HARD":
      return [
        {
          templateId: "mock-template-hard-1",
          title: "그래프 탐색",
          description: "조금 더 긴 구현 흐름을 요구하는 도전 미션이에요.",
          difficulty,
        },
      ];
    default:
      return [];
  }
}

function createFallbackResponse(state: MockMainPageState, message: string) {
  const stepNumber = state.messages.length + 1;
  const ids = createRequestIds(stepNumber);
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "TEXT",
    content: "목데이터 모드에서는 '방 만들어줘'로 시작한 뒤 난이도와 템플릿을 선택해보세요.",
    createdAt: createIsoTimestamp(stepNumber + 1),
  });

  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_CREATE",
    requestStatus: "FAILED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_CREATE",
      status: "FAILED",
      apiPath: "/v1/game-rooms",
      gameRoomId: null,
      title: null,
      participants: null,
      started: null,
    },
  });
}

function createRoomCreateStartResponse(state: MockMainPageState, message: string) {
  const ids = createRequestIds(state.messages.length + 1);
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: "좋아요! 먼저 만들고 싶은 방의 난이도를 골라주세요.",
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  state.step = "waiting-difficulty";
  state.currentTemplates = [];
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_CREATE",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_CREATE",
      status: "PENDING",
      apiPath: "/v1/game-rooms",
      gameRoomId: null,
      title: null,
      participants: null,
      started: null,
    },
  });
}

function createDifficultyResponse(
  state: MockMainPageState,
  message: string,
  difficulty: "EASY" | "NORMAL" | "HARD",
) {
  const ids = createRequestIds(state.messages.length + 1);
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: `${difficulty === "EASY" ? "쉬운" : difficulty === "NORMAL" ? "보통" : "어려운"} 난이도에서 선택할 수 있는 템플릿이에요.`,
    metadata: {
      difficulty,
      templates: getTemplatesByDifficulty(difficulty),
    },
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  state.step = "waiting-template";
  state.currentTemplates = getTemplatesByDifficulty(difficulty);
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_CREATE",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_CREATE",
      status: "PENDING",
      apiPath: "/v1/game-rooms",
      gameRoomId: null,
      title: null,
      participants: null,
      started: null,
    },
  });
}

function createTemplateResponse(state: MockMainPageState, message: string) {
  const ids = createRequestIds(state.messages.length + 1);
  const room =
    state.scenario === "presentation-owner" ? createPresentationOwnerRoom() : createCurrentRoom();
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content:
      state.scenario === "presentation-owner"
        ? "방이 생성되었어요! 친구들을 초대해보세요."
        : "방 생성을 완료했어요. `/main`에서 바로 대기방 모드로 이어질게요.",
    metadata: {
      gameRoomId: room.gameRoomId,
      roomStatus: room.status,
    },
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  state.step = "room-created";
  state.currentRoom = room;
  state.roomParticipants = [
    createRoomParticipant({
      participantId: "mock-room-owner-participant-1",
      gameRoomId: room.gameRoomId,
      gameRoomTitle: room.title,
      userId:
        state.scenario === "presentation-owner"
          ? PRESENTATION_OWNER_USER.userId
          : MAIN_PAGE_MOCK_USER.userId,
      nickname:
        state.scenario === "presentation-owner"
          ? PRESENTATION_OWNER_USER.nickname
          : MAIN_PAGE_MOCK_USER.nickname,
      role: "OWNER",
      status: "JOINED",
    }),
  ];
  state.currentTemplates = [];
  state.session = {
    ...state.session,
    gameRoomId: room.gameRoomId,
  };
  state.currentRoomSyncLag = state.scenario === "room-create-delay" ? 1 : 0;
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_CREATE",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_CREATE",
      status: "SUCCESS",
      apiPath: "/v1/game-rooms",
      gameRoomId: room.gameRoomId,
      title: room.title,
      participants: null,
      started: false,
    },
  });
}

function createPresentationInviteResponse(state: MockMainPageState, message: string) {
  const ids = createRequestIds(state.messages.length + 1);
  const room = createPresentationOwnerRoom();
  const invitees = extractPresentationInvitees(message);
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: `${invitees.join(", ")}님에게 초대가 전송되었어요. 친구가 초대를 수락하면 알려드릴게요.`,
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  PRESENTATION_GUEST_USERS.forEach((guestUser) =>
    setPresentationGuestJoined(guestUser.nickname, false),
  );
  setPresentationInvitees(invitees);
  state.currentRoom = room;
  state.roomParticipants = [createPresentationOwnerParticipant()];
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "USER_INVITE",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "USER_INVITE",
      status: "SUCCESS",
      apiPath: `/v1/game-rooms/${room.gameRoomId}/invitations`,
      gameRoomId: room.gameRoomId,
      title: room.title,
      participants: invitees,
      started: false,
    },
  });
}

function createInvalidTemplateResponse(state: MockMainPageState, message: string) {
  const ids = createRequestIds(state.messages.length + 1);
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: "제시된 템플릿 중 하나를 선택하거나 템플릿 이름으로 다시 확인해주세요.",
    metadata: {
      templates: state.currentTemplates,
    },
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_CREATE",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_CREATE",
      status: "PENDING",
      apiPath: "/v1/game-rooms",
      gameRoomId: null,
      title: null,
      participants: null,
      started: null,
    },
  });
}

function createRoomJoinResponse(
  state: MockMainPageState,
  message: string,
  presentationGuestNickname = DEFAULT_PRESENTATION_GUEST_NICKNAME,
) {
  const ids = createRequestIds(state.messages.length + 1);
  const isPresentationGuest = state.scenario === "presentation-guest";
  if (isPresentationGuest) {
    setPresentationGuestJoined(presentationGuestNickname, true);
  }
  const room = isPresentationGuest
    ? createPresentationGuestRoom()
    : createJoinedInvitationRoom();
  const invitation =
    state.invitations[0] ??
    (isPresentationGuest
      ? createPresentationInvitation(presentationGuestNickname)
      : createInvitationParticipant());
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: "초대를 수락했고 방 참가를 완료했어요.",
    metadata: {
      joinSource: "INVITATION_ACCEPT",
      membershipStatus: "JOINED",
      gameRoomId: room.gameRoomId,
    },
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  state.currentRoom = room;
  state.invitations = [];
  state.roomParticipants = isPresentationGuest ? createPresentationParticipants() : [
    createRoomParticipant({
      participantId: "mock-room-owner-participant-2",
      gameRoomId: room.gameRoomId,
      gameRoomTitle: room.title,
      userId: "mock-owner-1",
      nickname: "목방장",
      role: "OWNER",
      status: "JOINED",
    }),
    createRoomParticipant({
      participantId: "mock-room-player-participant-2",
      gameRoomId: room.gameRoomId,
      gameRoomTitle: room.title,
      userId: MAIN_PAGE_MOCK_USER.userId,
      nickname: MAIN_PAGE_MOCK_USER.nickname,
      role: "PARTICIPANT",
      status: "JOINED",
    }),
  ];
  state.session = {
    ...state.session,
    gameRoomId: room.gameRoomId,
  };
  state.currentRoomSyncLag = state.scenario === "invitation-delay" ? 1 : 0;
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "ROOM_JOIN",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "ROOM_JOIN",
      status: "SUCCESS",
      apiPath: `/v1/game-room-participants/${invitation.participantId}/join`,
      gameRoomId: room.gameRoomId,
      title: room.title,
      participants: state.roomParticipants.map((participant) => participant.nickname),
      started: false,
    },
  });
}

function createInvitationDenyResponse(state: MockMainPageState, message: string) {
  const ids = createRequestIds(state.messages.length + 1);
  const invitation = state.invitations[0] ?? createInvitationParticipant();
  const userMessage = createMessage({
    messageId: ids.userMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "USER",
    messageType: "TEXT",
    content: message,
    createdAt: ids.timestamp,
  });
  const assistantMessage = createMessage({
    messageId: ids.assistantMessageId,
    aiChatRequestId: ids.aiChatRequestId,
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: "초대를 거절했고 초대장도 목록에서 정리했어요.",
    metadata: {
      membershipStatus: "DENIED",
      gameRoomId: invitation.gameRoomId,
    },
    createdAt: createIsoTimestamp(state.messages.length + 2),
  });

  state.invitations = [];
  state.roomParticipants = [];
  appendMessages(state, userMessage, assistantMessage);

  return buildResponse({
    aiChatRequestId: ids.aiChatRequestId,
    requestType: "USER_INVITE_DENY",
    requestStatus: "COMPLETED",
    userMessage,
    assistantMessage,
    commandResult: {
      commandType: "USER_INVITE_DENY",
      status: "SUCCESS",
      apiPath: `/v1/game-room-participants/${invitation.participantId}/deny`,
      gameRoomId: invitation.gameRoomId,
      title: invitation.gameRoomTitle,
      participants: null,
      started: false,
    },
  });
}

export function getMainPageMockScenario(search: string) {
  const params = new URLSearchParams(search);
  const value = params.get(MAIN_PAGE_MOCK_PARAM);

  return isMainPageMockScenario(value) ? value : null;
}

export function isMainPageMockModeEnabled(search: string) {
  return getMainPageMockScenario(search) !== null;
}

export function createMainPageMockApi(
  scenario: MainPageMockScenario,
  instanceId = `mock-instance-${++mockInstanceCounter}`,
  presentationGuestNickname = DEFAULT_PRESENTATION_GUEST_NICKNAME,
) {
  return {
    async getCurrentRooms() {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);
      syncPresentationOwnerGuestJoin(state);

      if (state.currentRoomSyncLag > 0) {
        state.currentRoomSyncLag -= 1;
        return [];
      }

      return state.currentRoom ? [state.currentRoom] : [];
    },

    async getInvitedParticipants(_: string) {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);
      syncPresentationGuestInvitation(state, presentationGuestNickname);
      return state.invitations;
    },

    async getRoomParticipants(_: string) {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);
      syncPresentationOwnerGuestJoin(state);
      return state.roomParticipants;
    },

    async getSessions(_: string) {
      return [getScenarioState(scenario, instanceId, presentationGuestNickname).session];
    },

    async getMessages(_: string) {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);
      syncPresentationOwnerGuestJoin(state);
      syncPresentationGuestInvitation(state, presentationGuestNickname);
      return state.messages;
    },

    async sendMessage(_: string, request: { message: string }): Promise<SendAiChatMessageResponse> {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);
      const normalizedMessage = normalizeMessage(request.message);

      if (
        (scenario === "invitation" ||
          scenario === "invitation-delay" ||
          scenario === "presentation-guest") &&
        state.invitations.length > 0
      ) {
        if (normalizedMessage.includes("수락") || normalizedMessage.includes("참가")) {
          return createRoomJoinResponse(
            state,
            request.message.trim(),
            presentationGuestNickname,
          );
        }

        if (normalizedMessage.includes("거절") || normalizedMessage.includes("사양")) {
          return createInvitationDenyResponse(state, request.message.trim());
        }
      }

      if (
        scenario === "presentation-owner" &&
        state.currentRoom &&
        (normalizedMessage.includes("초대") || normalizedMessage.includes("불러"))
      ) {
        return createPresentationInviteResponse(state, request.message.trim());
      }

      if (
        state.step === "idle" &&
        (normalizedMessage.includes("방 만들어줘") || normalizedMessage.includes("방 생성"))
      ) {
        return createRoomCreateStartResponse(state, request.message.trim());
      }

      if (state.step === "waiting-difficulty") {
        const difficulty = detectDifficulty(normalizedMessage);

        if (difficulty) {
          return createDifficultyResponse(state, request.message.trim(), difficulty);
        }
      }

      if (state.step === "waiting-template") {
        const matchedTemplate = state.currentTemplates.find((template) =>
          normalizedMessage.includes(template.title.toLowerCase()),
        );

        if (matchedTemplate) {
          return createTemplateResponse(state, request.message.trim());
        }

        return createInvalidTemplateResponse(state, request.message.trim());
      }

      return createFallbackResponse(state, request.message.trim());
    },

    async startGame(gameRoomId: string) {
      const state = getScenarioState(scenario, instanceId, presentationGuestNickname);

      if (!state.currentRoom || state.currentRoom.gameRoomId !== gameRoomId) {
        return { success: false };
      }

      return { success: true };
    },

    reset() {
      if (scenario === "presentation-owner") {
        PRESENTATION_GUEST_USERS.forEach((guestUser) =>
          setPresentationGuestJoined(guestUser.nickname, false),
        );
        setPresentationInvitees([]);
      }
      mockStates.set(
        instanceId,
        createInitialMockState(scenario, presentationGuestNickname),
      );
    },
  };
}
