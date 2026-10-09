import type { AiChatCommandResult, AiChatMessage } from "../../shared/types/domain";

export type RoomCreateDifficulty = "EASY" | "NORMAL" | "HARD";

export type RoomCreateTemplateOption = {
  templateId: string;
  title: string;
  description: string;
  difficulty: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoomCreateDifficulty(value: unknown): value is RoomCreateDifficulty {
  return value === "EASY" || value === "NORMAL" || value === "HARD";
}

function parseTemplateOption(value: unknown): RoomCreateTemplateOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const templateId = value.templateId;
  const title = value.title;
  const description = value.description;
  const difficulty = value.difficulty;

  if (
    typeof templateId !== "string" ||
    typeof title !== "string" ||
    typeof description !== "string"
  ) {
    return null;
  }

  return {
    templateId,
    title,
    description,
    difficulty: typeof difficulty === "string" ? difficulty : null,
  };
}

export function extractMissionTemplateOptions(
  metadata: unknown,
  difficulty?: RoomCreateDifficulty,
) {
  if (!isRecord(metadata) || !Array.isArray(metadata.templates)) {
    return [];
  }

  return metadata.templates
    .map(parseTemplateOption)
    .filter((template): template is RoomCreateTemplateOption => template !== null)
    .filter((template) => !difficulty || template.difficulty === difficulty);
}

export function extractRoomCreateTemplateOptions({
  messages,
  pendingRequestId,
}: {
  messages: AiChatMessage[];
  pendingRequestId: string | null;
}) {
  if (!pendingRequestId) {
    return [];
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message.senderType !== "ASSISTANT" ||
      message.aiChatRequestId !== pendingRequestId ||
      !isRecord(message.metadata)
    ) {
      continue;
    }

    const parsedTemplates = extractMissionTemplateOptions(message.metadata);

    if (parsedTemplates.length > 0) {
      return parsedTemplates;
    }
  }

  return [];
}

export function extractLatestRoomCreateDifficultyForRequest({
  messages,
  pendingRequestId,
}: {
  messages: AiChatMessage[];
  pendingRequestId: string | null;
}) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message.senderType !== "ASSISTANT" ||
      (pendingRequestId !== null && message.aiChatRequestId !== pendingRequestId) ||
      !isRecord(message.metadata)
    ) {
      continue;
    }

    const { difficulty } = message.metadata;

    if (isRoomCreateDifficulty(difficulty)) {
      return difficulty;
    }
  }

  return null;
}

export function extractLatestMissionTemplateIdForRoom({
  messages,
  gameRoomId,
}: {
  messages: AiChatMessage[];
  gameRoomId: string | null;
}) {
  if (!gameRoomId) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.senderType !== "ASSISTANT" || !isRecord(message.metadata)) {
      continue;
    }

    const metadataGameRoomId = message.metadata.gameRoomId;
    const missionTemplateId = message.metadata.missionTemplateId;

    if (metadataGameRoomId !== gameRoomId || typeof missionTemplateId !== "string") {
      continue;
    }

    return missionTemplateId;
  }

  return null;
}

export function shouldShowRoomCreateDifficultySelection(
  pendingCommand: AiChatCommandResult | null,
  templates: RoomCreateTemplateOption[],
) {
  return (
    pendingCommand?.commandType === "ROOM_CREATE" &&
    pendingCommand.status === "PENDING" &&
    templates.length === 0
  );
}

export function buildRoomCreateDifficultyMessage(difficulty: RoomCreateDifficulty) {
  switch (difficulty) {
    case "EASY":
      return "쉬운 난이도로 방 만들어줘.";
    case "NORMAL":
      return "보통 난이도로 방 만들어줘.";
    case "HARD":
      return "어려운 난이도로 방 만들어줘.";
    default:
      return "방 만들어줘.";
  }
}

export function buildRoomCreateTemplateConfirmationMessage(
  template: RoomCreateTemplateOption,
) {
  return `${template.title} 템플릿으로 진행할게요.`;
}
