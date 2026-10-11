import type { AiChatClientState } from "../../shared/types/clientState";
import type {
  AiChatCommandResult,
  AiChatMessage,
  SendAiChatMessageResponse,
} from "../../shared/types/domain";

function appendUniqueMessages(
  previousMessages: AiChatMessage[],
  nextMessages: Array<AiChatMessage | undefined>,
) {
  const seenMessageIds = new Set(previousMessages.map((message) => message.messageId));
  const appendedMessages = nextMessages.filter((message): message is AiChatMessage => {
    if (!message || seenMessageIds.has(message.messageId)) {
      return false;
    }

    seenMessageIds.add(message.messageId);
    return true;
  });

  return [...previousMessages, ...appendedMessages];
}

function normalizeCommandResult({
  requestType,
  commandResult,
}: Pick<SendAiChatMessageResponse, "requestType" | "commandResult">) {
  if (!commandResult) {
    return null;
  }

  if (commandResult.commandType === requestType) {
    return commandResult;
  }

  return {
    ...commandResult,
    commandType: requestType,
  };
}

export function derivePendingAiChatCommand(
  response: SendAiChatMessageResponse,
): AiChatCommandResult | null {
  if (response.requestStatus === "FAILED") {
    return null;
  }

  const commandResult = normalizeCommandResult(response);

  if (!commandResult) {
    return null;
  }

  switch (response.requestType) {
    case "ROOM_CREATE":
    case "ROOM_DELETE":
    case "USER_INVITE":
    case "ROOM_JOIN":
    case "USER_INVITE_DENY":
    case "GAME_START":
      return commandResult.status === "PENDING" ? commandResult : null;
    default:
      return null;
  }
}

export function syncSentAiChatResponse({
  previousState,
  activeSessionId,
  response,
}: {
  previousState: AiChatClientState;
  activeSessionId: string;
  response: SendAiChatMessageResponse;
}) {
  const pendingCommand = derivePendingAiChatCommand(response);

  return {
    activeSessionId,
    messages: appendUniqueMessages(previousState.messages, [
      response.userMessage,
      response.assistantMessage,
    ]),
    pendingCommand,
    pendingRequestId: pendingCommand ? response.aiChatRequestId : null,
  };
}
