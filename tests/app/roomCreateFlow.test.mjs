import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoomCreateDifficultyMessage,
  buildRoomCreateTemplateConfirmationMessage,
  extractLatestRoomCreateDifficultyForRequest,
  extractLatestMissionTemplateIdForRoom,
  extractMissionTemplateOptions,
  extractRoomCreateTemplateOptions,
  shouldShowRoomCreateDifficultySelection,
} from "../../src/features/ai-chat/roomCreateFlow.ts";

function createMessage(overrides = {}) {
  return {
    messageId: "message-1",
    aiChatRequestId: "request-1",
    senderType: "ASSISTANT",
    messageType: "COMMAND_RESULT",
    content: "후속 안내 메시지",
    metadata: null,
    createdAt: "2026-05-25T12:05:00Z",
    ...overrides,
  };
}

function createPendingRoomCreateCommand(overrides = {}) {
  return {
    commandType: "ROOM_CREATE",
    status: "PENDING",
    apiPath: "/v1/game-rooms",
    gameRoomId: null,
    participants: null,
    started: null,
    ...overrides,
  };
}

test("extractRoomCreateTemplateOptions returns the latest assistant template candidates", () => {
  const templates = extractRoomCreateTemplateOptions({
    messages: [
      createMessage({
        messageId: "message-old",
        aiChatRequestId: "request-old",
        metadata: {
          templates: [
            {
              templateId: "template-old",
              title: "이전 템플릿",
              description: "이전 설명",
              difficulty: "EASY",
            },
          ],
        },
      }),
      createMessage({
        messageId: "message-latest",
        aiChatRequestId: "request-active",
        metadata: {
          difficulty: "NORMAL",
          templates: [
            {
              templateId: "template-latest",
              title: "최신 템플릿",
              description: "최신 설명",
              difficulty: "NORMAL",
            },
          ],
        },
      }),
    ],
    pendingRequestId: "request-active",
  });

  assert.deepEqual(templates, [
    {
      templateId: "template-latest",
      title: "최신 템플릿",
      description: "최신 설명",
      difficulty: "NORMAL",
    },
  ]);
});

test("extractRoomCreateTemplateOptions ignores stale template metadata from a previous request", () => {
  const templates = extractRoomCreateTemplateOptions({
    messages: [
      createMessage({
        messageId: "message-old",
        aiChatRequestId: "request-old",
        metadata: {
          templates: [
            {
              templateId: "template-old",
              title: "이전 템플릿",
              description: "이전 설명",
              difficulty: "EASY",
            },
          ],
        },
      }),
      createMessage({
        messageId: "message-new",
        aiChatRequestId: "request-new",
        metadata: null,
      }),
    ],
    pendingRequestId: "request-new",
  });

  assert.deepEqual(templates, []);
});

test("extractMissionTemplateOptions returns only selectable templates for the practice difficulty", () => {
  const templates = extractMissionTemplateOptions(
    {
      templates: [
        {
          templateId: "template-easy",
          title: "기초 산술 연산",
          description: "입문 문제",
          difficulty: "EASY",
        },
        {
          templateId: "template-hard",
          title: "그래프 탐색",
          description: "도전 문제",
          difficulty: "HARD",
        },
        { templateId: "invalid" },
      ],
    },
    "EASY",
  );

  assert.deepEqual(templates, [
    {
      templateId: "template-easy",
      title: "기초 산술 연산",
      description: "입문 문제",
      difficulty: "EASY",
    },
  ]);
  assert.deepEqual(extractMissionTemplateOptions(null, "EASY"), []);
});

test("extractLatestRoomCreateDifficultyForRequest returns difficulty metadata only for the active request", () => {
  const difficulty = extractLatestRoomCreateDifficultyForRequest({
    messages: [
      createMessage({
        messageId: "message-older",
        aiChatRequestId: "request-old",
        metadata: {
          difficulty: "EASY",
        },
      }),
      createMessage({
        messageId: "message-latest",
        aiChatRequestId: "request-active",
        metadata: {
          difficulty: "HARD",
        },
      }),
    ],
    pendingRequestId: "request-active",
  });

  assert.equal(difficulty, "HARD");
});

test("extractLatestMissionTemplateIdForRoom returns the latest template id for the current room", () => {
  const missionTemplateId = extractLatestMissionTemplateIdForRoom({
    messages: [
      createMessage({
        messageId: "message-other-room",
        metadata: {
          gameRoomId: "room-other",
          missionTemplateId: "template-other",
        },
      }),
      createMessage({
        messageId: "message-current-room",
        metadata: {
          gameRoomId: "room-1",
          missionTemplateId: "template-current",
        },
      }),
    ],
    gameRoomId: "room-1",
  });

  assert.equal(missionTemplateId, "template-current");
});

test("shouldShowRoomCreateDifficultySelection stays visible only while ROOM_CREATE is pending and no templates exist", () => {
  assert.equal(
    shouldShowRoomCreateDifficultySelection(createPendingRoomCreateCommand(), []),
    true,
  );

  assert.equal(
    shouldShowRoomCreateDifficultySelection(createPendingRoomCreateCommand(), [
      {
        templateId: "template-1",
        title: "기초 산술 연산",
        description: "입문 템플릿",
        difficulty: "EASY",
      },
    ]),
    false,
  );

  assert.equal(
    shouldShowRoomCreateDifficultySelection(
      createPendingRoomCreateCommand({
        status: "SUCCESS",
        gameRoomId: "room-1",
      }),
      [],
    ),
    false,
  );
});

test("buildRoomCreateDifficultyMessage creates natural-language follow-up messages", () => {
  assert.equal(buildRoomCreateDifficultyMessage("EASY"), "쉬운 난이도로 방 만들어줘.");
  assert.equal(buildRoomCreateDifficultyMessage("NORMAL"), "보통 난이도로 방 만들어줘.");
  assert.equal(buildRoomCreateDifficultyMessage("HARD"), "어려운 난이도로 방 만들어줘.");
});

test("buildRoomCreateTemplateConfirmationMessage creates a natural-language template confirmation", () => {
  assert.equal(
    buildRoomCreateTemplateConfirmationMessage({
      templateId: "template-1",
      title: "기초 산술 연산",
      description: "입문 템플릿",
      difficulty: "EASY",
    }),
    "기초 산술 연산 템플릿으로 진행할게요.",
  );
});
