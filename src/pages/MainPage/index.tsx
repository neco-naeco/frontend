import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore, useAppStoreApi } from "../../app/providers/ClientStateProvider";
import { aiChatApi } from "../../features/ai-chat/aiChatApi";
import { syncSentAiChatResponse } from "../../features/ai-chat/aiChatMessage";
import {
  buildRoomCreateDifficultyMessage,
  buildRoomCreateTemplateConfirmationMessage,
  extractLatestRoomCreateDifficultyForRequest,
  extractRoomCreateTemplateOptions,
  shouldShowRoomCreateDifficultySelection,
  type RoomCreateDifficulty,
  type RoomCreateTemplateOption,
} from "../../features/ai-chat/roomCreateFlow";
import { gameRoomApi } from "../../features/game-room/gameRoomApi";
import {
  buildInvitationAcceptMessage,
  buildInvitationDenyMessage,
  isRetryableInvitationActionError,
  resolveCompletedInvitationIds,
  type InvitationActionType,
} from "../../features/invitation/invitationFlow";
import { invitationApi } from "../../features/invitation/invitationApi";
import { roomWaitingApi } from "../../features/room-waiting/roomWaitingApi";
import {
  buildParticipantChangeSummary,
  buildRoomWaitingState,
  getMembershipStatusLabel,
  getParticipantRoleLabel,
  getWaitingRoomStartButtonState,
} from "../../features/room-waiting/roomWaitingState";
import { SignupMascotIllustration } from "../../shared/components/SignupMascotIllustration";
import type {
  AiChatMessage,
  CurrentGameRoom,
  GameRoomParticipant,
  GameRoomStatus,
  RoomWaitingParticipant,
  RoomWaitingState,
} from "../../shared/types/domain";
import { getUserFacingErrorMessage } from "../../shared/utils/appError";
import {
  deriveMainPageAiChatView,
  loadAiChatMessages,
  loadAiChatSessions,
  syncAiChatMessages,
  syncAiChatSessionSelection,
} from "./aiChatInitialization";
import {
  deriveMainPageInitializationView,
  loadCurrentRoomState,
  loadInvitations,
} from "./mainInitialization";
import {
  createMainPageMockApi,
  getMainPageMockUser,
  getMainPageMockScenario,
  isPresentationMockScenario,
  PRESENTATION_INVITES_STORAGE_KEY,
  PRESENTATION_MOCK_STORAGE_KEY,
} from "./mockMode";
import { notifyAuthLogout } from "../../shared/api/authStorage";

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5.25 7.5 4.75 5 4.75-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.5 3.5 10 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m20.5 3.5-6.4 17-3.15-6.85L4.1 10.5l16.4-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserAvatar({ label }: { label: string }) {
  const initial = label.trim().charAt(0) || "?";

  return <span className="main-user-chip__avatar">{initial}</span>;
}

function AiAvatar() {
  return (
    <span className="main-message__avatar main-message__avatar--ai" aria-hidden="true">
      AI
    </span>
  );
}

function formatChatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getRoomStatusLabel(status: GameRoomStatus) {
  switch (status) {
    case "WAITING":
      return "대기중";
    case "IN_PROGRESS":
      return "진행중";
    case "JUDGING":
      return "판정중";
    case "ANALYZED":
      return "분석중";
    case "FINISHED":
      return "완료";
    default:
      return status;
  }
}

function getDifficultyLabel(difficulty: string | null) {
  switch (difficulty) {
    case "EASY":
      return "쉬움";
    case "NORMAL":
      return "보통";
    case "HARD":
      return "어려움";
    default:
      return difficulty ?? "미정";
  }
}

function MainGuideSidebar() {
  return (
    <aside className="main-guide">
      <div className="main-guide__content">
        <h2>AI와 함께 코딩 릴레이!</h2>

        <ol className="main-guide__steps">
          <li>
            <strong>1. 게임룸 생성</strong>
            <p>채팅창에 명령 한 마디로 방을 만드세요.</p>
          </li>
          <li>
            <strong>2. 친구 초대</strong>
            <p>AI에게 말해서 친구들을 불러보세요.</p>
          </li>
          <li>
            <strong>3. 코드 바통 터치</strong>
            <p>미션을 해결하고 다음 주자에게 넘기세요!</p>
          </li>
        </ol>
      </div>

      <div className="main-guide__mascots" aria-hidden="true">
        <SignupMascotIllustration />
      </div>
    </aside>
  );
}

function MainMockModeNotice({
  scenario,
  onReset,
}: {
  scenario: string;
  onReset: () => void;
}) {
  const scenarioLabel =
    scenario === "room-create-delay" ||
    scenario === "invitation" ||
    scenario === "invitation-delay" ||
    scenario === "start-ready"
      ? scenario
      : "room-create";
  const description =
    scenario === "invitation" || scenario === "invitation-delay"
      ? "백엔드 없이 `/main` 초대 수락/거절 흐름을 확인하는 목데이터 모드예요."
      : scenario === "start-ready"
        ? "백엔드 없이 `/main` 대기방 게임 시작 요청 흐름을 확인하는 목데이터 모드예요."
      : "백엔드 없이 `/main` ROOM_CREATE 흐름을 확인하는 목데이터 모드예요.";

  return (
    <AssistantMessage>
      <p className="main-chat-shell__waiting-badge">Mock Mode</p>
      <p>{description}</p>
      <p>
        현재 시나리오: <strong>{scenarioLabel}</strong>
      </p>
      <button type="button" className="main-chat-shell__retry" onClick={onReset}>
        목 시나리오 처음부터 다시 보기
      </button>
    </AssistantMessage>
  );
}

function MainLoadingState() {
  return (
    <div className="main-chat-shell">
      <div className="main-chat-shell__body">
        <div className="main-message main-message--assistant main-message--skeleton">
          <div className="main-message__meta">
            <AiAvatar />
            <span className="main-message__sender">AI 마스터</span>
          </div>
          <div className="main-message__bubble">
            <div className="main-skeleton main-skeleton--line main-skeleton--wide" />
            <div className="main-skeleton main-skeleton--line" />
            <div className="main-skeleton main-skeleton--line main-skeleton--short" />
          </div>
        </div>

        <div className="main-message main-message--assistant main-message--skeleton">
          <div className="main-message__meta">
            <AiAvatar />
            <span className="main-message__sender">AI 마스터</span>
          </div>
          <div className="main-message__bubble">
            <div className="main-skeleton main-skeleton--line" />
            <div className="main-skeleton main-skeleton--line main-skeleton--medium" />
          </div>
        </div>
      </div>

      <MainChatComposer
        value=""
        placeholder="초기화 중입니다..."
        disabled
        isPending={false}
      />
    </div>
  );
}

function MainChatLoadingBubbles() {
  return (
    <>
      <div className="main-message main-message--assistant main-message--skeleton">
        <div className="main-message__meta">
          <AiAvatar />
          <span className="main-message__sender">AI 마스터</span>
        </div>
        <div className="main-message__bubble">
          <div className="main-skeleton main-skeleton--line main-skeleton--wide" />
          <div className="main-skeleton main-skeleton--line" />
        </div>
      </div>

      <div className="main-message main-message--assistant main-message--skeleton">
        <div className="main-message__meta">
          <AiAvatar />
          <span className="main-message__sender">AI 마스터</span>
        </div>
        <div className="main-message__bubble">
          <div className="main-skeleton main-skeleton--line main-skeleton--medium" />
          <div className="main-skeleton main-skeleton--line main-skeleton--short" />
        </div>
      </div>
    </>
  );
}

function MainErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="main-chat-shell">
      <div className="main-chat-shell__body">
        <div className="main-message main-message--assistant">
          <div className="main-message__meta">
            <AiAvatar />
            <span className="main-message__sender">AI 마스터</span>
          </div>
          <div className="main-message__bubble main-message__bubble--error">
            <p className="main-chat-shell__status-title">초기화에 실패했어요.</p>
            <p className="main-chat-shell__status-copy">{message}</p>
            <button type="button" className="main-chat-shell__retry" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        </div>
      </div>

      <MainChatComposer
        value=""
        placeholder="초기화가 완료되면 채팅을 사용할 수 있어요."
        disabled
        isPending={false}
      />
    </div>
  );
}

function MainPartialErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <AssistantMessage>
      <p className="main-chat-shell__warning">{title}</p>
      <p>{message}</p>
      <button type="button" className="main-chat-shell__retry" onClick={onRetry}>
        다시 시도
      </button>
    </AssistantMessage>
  );
}

function MainChatComposer({
  value,
  placeholder,
  disabled,
  isPending,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  isPending: boolean;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className={`main-chat-shell__composer${disabled ? " main-chat-shell__composer--disabled" : ""}`}
      onSubmit={onSubmit}
    >
      <input
        value={value}
        placeholder={placeholder}
        readOnly={!onChange}
        disabled={disabled}
        onChange={onChange}
        aria-label="메시지 입력"
      />
      <button type="submit" disabled={disabled} aria-label="메시지 전송">
        {isPending ? <span className="main-chat-shell__composer-spinner" aria-hidden="true" /> : <SendIcon />}
      </button>
    </form>
  );
}

function AssistantMessage({
  children,
  timestamp,
}: {
  children: ReactNode;
  timestamp?: string;
}) {
  return (
    <div className="main-message main-message--assistant">
      <div className="main-message__meta">
        <AiAvatar />
        <span className="main-message__sender">AI 마스터</span>
      </div>
      <div className="main-message__bubble">
        {children}
        {timestamp ? <span className="main-message__time">{formatChatTime(timestamp)}</span> : null}
      </div>
    </div>
  );
}

function ChatHistoryMessage({
  message,
}: {
  message: AiChatMessage;
}) {
  const isUserMessage = message.senderType === "USER";

  return (
    <div className={`main-message ${isUserMessage ? "main-message--user" : "main-message--assistant"}`}>
      {!isUserMessage ? (
        <div className="main-message__meta">
          <AiAvatar />
          <span className="main-message__sender">
            {message.senderType === "SYSTEM" ? "시스템" : "AI 마스터"}
          </span>
        </div>
      ) : null}
      <div
        className={`main-message__bubble${
          isUserMessage ? " main-message__bubble--user" : ""
        }`}
      >
        <p>{message.content}</p>
        <span className="main-message__time">{formatChatTime(message.createdAt)}</span>
      </div>
    </div>
  );
}

function CurrentRoomSummary({ room }: { room: CurrentGameRoom }) {
  return (
    <div className="main-room-card">
      <div className="main-room-card__header">
        <strong>{room.title}</strong>
        <span className="main-room-card__status">{getRoomStatusLabel(room.status)}</span>
      </div>
      <dl className="main-room-card__details">
        <div>
          <dt>내 역할</dt>
          <dd>{room.myRole === "OWNER" ? "방장" : "참가자"}</dd>
        </div>
        <div>
          <dt>참여 인원</dt>
          <dd>
            {room.joinedParticipantCount}/{room.maxParticipants}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function WaitingRoomStatusCard({ room }: { room: CurrentGameRoom }) {
  return (
    <div className="main-room-card">
      <div className="main-room-card__header">
        <strong>{room.title}</strong>
        <span className="main-room-card__status">{getRoomStatusLabel(room.status)}</span>
      </div>
      <dl className="main-room-card__details">
        <div>
          <dt>현재 인원</dt>
          <dd>
            {room.joinedParticipantCount}/{room.maxParticipants}
          </dd>
        </div>
        <div>
          <dt>시작 최소 인원</dt>
          <dd>{room.minParticipants}명</dd>
        </div>
        <div>
          <dt>내 역할</dt>
          <dd>{room.myRole === "OWNER" ? "방장" : "참가자"}</dd>
        </div>
        <div>
          <dt>내 참가 상태</dt>
          <dd>{getMembershipStatusLabel(room.myMembershipStatus)}</dd>
        </div>
      </dl>
    </div>
  );
}

function WaitingRoomParticipantList({
  participants,
}: {
  participants: RoomWaitingParticipant[];
}) {
  return (
    <div className="main-waiting-participants">
      {participants.map((participant) => (
        <article key={participant.userId} className="main-waiting-participant">
          <div className="main-waiting-participant__header">
            <strong>{participant.nickname}</strong>
            <span className="main-waiting-participant__role">
              {getParticipantRoleLabel(participant.role)}
            </span>
          </div>
          <p>{getMembershipStatusLabel(participant.membershipStatus)}</p>
        </article>
      ))}
    </div>
  );
}

function WaitingRoomLoadingState() {
  return (
    <div className="main-waiting-room">
      <div className="main-room-card">
        <div className="main-room-card__details">
          <div className="main-skeleton main-skeleton--line main-skeleton--wide" />
          <div className="main-skeleton main-skeleton--line main-skeleton--medium" />
        </div>
      </div>

      <div className="main-waiting-participants">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={`waiting-skeleton-${index}`} className="main-waiting-participant main-waiting-participant--skeleton">
            <div className="main-skeleton main-skeleton--line main-skeleton--medium" />
            <div className="main-skeleton main-skeleton--line main-skeleton--short" />
          </div>
        ))}
      </div>
    </div>
  );
}

function WaitingRoomStatusSection({
  roomWaitingState,
  startButtonNotice,
  isStartRequestPending,
  isStartRequestAccepted,
  onStartGame,
}: {
  roomWaitingState: RoomWaitingState;
  startButtonNotice: string | null;
  isStartRequestPending: boolean;
  isStartRequestAccepted: boolean;
  onStartGame: () => void;
}) {
  const { canShowStartButton, canClickStartButton } = getWaitingRoomStartButtonState(
    roomWaitingState.currentRoom,
  );
  const participantChangeSummary = buildParticipantChangeSummary(
    roomWaitingState.changedParticipant,
  );
  const isStartButtonDisabled =
    !canClickStartButton || isStartRequestPending || isStartRequestAccepted;
  const startButtonLabel = isStartRequestPending
    ? "시작 요청 전송 중..."
    : isStartRequestAccepted
      ? "시작 요청 접수됨"
      : "게임 시작";
  const startDescription = canClickStartButton
    ? isStartRequestAccepted
      ? "시작 요청은 접수됐어요. 실제 게임 진입은 `game-started` 실시간 이벤트를 기다립니다."
      : "현재 인원 조건을 만족했어요. 시작 요청을 보내고 실시간 이벤트를 기다립니다."
    : `최소 ${roomWaitingState.currentRoom.minParticipants}명이 모이면 게임을 시작할 수 있어요.`;

  return (
    <div className="main-waiting-room">
      <WaitingRoomStatusCard room={roomWaitingState.currentRoom} />

      {participantChangeSummary ? (
        <div className="main-waiting-room__change">
          <strong>최근 참가 상태 변경</strong>
          <p>{participantChangeSummary}</p>
        </div>
      ) : null}

      <div className="main-waiting-room__participants">
        <div className="main-waiting-room__participants-header">
          <strong>참가자 목록</strong>
          <span>{roomWaitingState.participants.length}명 표시 중</span>
        </div>
        <WaitingRoomParticipantList participants={roomWaitingState.participants} />
      </div>

      {canShowStartButton ? (
        <div className="main-waiting-room__start">
          <strong>게임 시작 준비</strong>
          <p>{startDescription}</p>
          <button
            type="button"
            className="main-waiting-room__start-button"
            disabled={isStartButtonDisabled}
            onClick={onStartGame}
          >
            {startButtonLabel}
          </button>
          {startButtonNotice ? <p className="main-waiting-room__start-note">{startButtonNotice}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type InvitationActionViewState = {
  action: InvitationActionType;
  errorMessage: string | null;
  retryable: boolean;
} | null;

function InvitationCard({
  invitation,
  actionState,
  disabled,
  onAccept,
  onDeny,
  onRetry,
}: {
  invitation: GameRoomParticipant;
  actionState: InvitationActionViewState;
  disabled: boolean;
  onAccept: () => void;
  onDeny: () => void;
  onRetry: () => void;
}) {
  const isTerminalError = Boolean(actionState?.errorMessage) && !actionState?.retryable;
  const isPending = disabled && actionState?.errorMessage === null;
  const isActionDisabled = disabled || isTerminalError;

  return (
    <article className="main-invitation-card">
      <header className="main-invitation-card__header">
        <strong>{invitation.gameRoomTitle}</strong>
        <span>{getRoomStatusLabel(invitation.roomStatus)}</span>
      </header>
      <p>
        {invitation.nickname}님이 초대했어요. 현재 상태는{" "}
        <strong>{invitation.status === "INVITED" ? "초대됨" : invitation.status}</strong> 입니다.
      </p>

      <div className="main-invitation-card__actions">
        <button
          type="button"
          className="main-invitation-card__button main-invitation-card__button--accept"
          disabled={isActionDisabled}
          onClick={onAccept}
        >
          {isPending && actionState?.action === "accept" ? "수락 처리 중..." : "초대 수락"}
        </button>
        <button
          type="button"
          className="main-invitation-card__button main-invitation-card__button--deny"
          disabled={isActionDisabled}
          onClick={onDeny}
        >
          {isPending && actionState?.action === "deny" ? "거절 처리 중..." : "거절"}
        </button>
      </div>

      {actionState?.errorMessage ? (
        <div className="main-invitation-card__error" role="status">
          <p>{actionState.errorMessage}</p>
          {actionState.retryable ? (
            <button
              type="button"
              className="main-invitation-card__retry"
              onClick={onRetry}
            >
              다시 시도
            </button>
          ) : (
            <p>이 초대장은 새로고침 후 최신 상태를 다시 확인해주세요.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function RoomCreateDifficultySelector({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (difficulty: RoomCreateDifficulty) => void;
}) {
  const options: Array<{ value: RoomCreateDifficulty; title: string; description: string }> = [
    {
      value: "EASY",
      title: "쉬움",
      description: "입문용 템플릿을 먼저 받아볼 수 있어요.",
    },
    {
      value: "NORMAL",
      title: "보통",
      description: "균형 잡힌 난이도의 방 후보를 받아볼 수 있어요.",
    },
    {
      value: "HARD",
      title: "어려움",
      description: "조금 더 도전적인 템플릿 중심으로 진행돼요.",
    },
  ];

  return (
    <AssistantMessage>
      <p>방 생성에 사용할 난이도를 골라주세요.</p>
      <div className="main-selection-grid">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="main-selection-card"
            disabled={disabled}
            onClick={() => {
              onSelect(option.value);
            }}
          >
            <strong>{option.title}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
    </AssistantMessage>
  );
}

function RoomCreateTemplateSelector({
  templates,
  selectedDifficulty,
  disabled,
  onSelect,
}: {
  templates: RoomCreateTemplateOption[];
  selectedDifficulty: string | null;
  disabled: boolean;
  onSelect: (template: RoomCreateTemplateOption) => void;
}) {
  return (
    <AssistantMessage>
      <p>
        {selectedDifficulty
          ? `${getDifficultyLabel(selectedDifficulty)} 난이도에서 선택할 수 있는 템플릿이에요.`
          : "선택할 수 있는 템플릿 목록이에요."}
      </p>
      <div className="main-selection-grid">
        {templates.map((template) => (
          <button
            key={template.templateId}
            type="button"
            className="main-selection-card"
            disabled={disabled}
            onClick={() => {
              onSelect(template);
            }}
          >
            <div className="main-selection-card__header">
              <strong>{template.title}</strong>
              <span>{getDifficultyLabel(template.difficulty)}</span>
            </div>
            <p>{template.description}</p>
          </button>
        ))}
      </div>
    </AssistantMessage>
  );
}

function RoomCreateConfirmation({
  template,
  disabled,
  onConfirm,
}: {
  template: RoomCreateTemplateOption;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AssistantMessage>
      <p>{template.title} 방을 생성할까요?</p>
      <div className="main-selection-grid">
        <div className="main-selection-card">
          <div className="main-selection-card__header">
            <strong>{template.title}</strong>
            <span>{getDifficultyLabel(template.difficulty)}</span>
          </div>
          <p>{template.description}</p>
        </div>
      </div>
      <button
        type="button"
        className="main-chat-shell__retry"
        disabled={disabled}
        onClick={onConfirm}
      >
        생성하기
      </button>
    </AssistantMessage>
  );
}

function WaitingRoomModeNotice({ room }: { room: CurrentGameRoom }) {
  return (
    <AssistantMessage timestamp={room.updatedAt}>
      <p className="main-chat-shell__waiting-badge">대기방 모드</p>
      <p>게임 시작 전 대기 중입니다.</p>
      <p>친구들이 입장할때까지 기다려주세요</p>
    </AssistantMessage>
  );
}

function WaitingRoomTransitionNotice({
  source,
  errorMessage,
  onRetry,
}: {
  source: "room-create" | "room-join";
  errorMessage: string | null;
  onRetry: () => void;
}) {
  const successMessage =
    source === "room-join"
      ? "초대를 수락했어요. 대기방 정보를 불러오는 중이에요."
      : "방 생성을 완료했어요. 대기방 정보를 불러오는 중이에요.";
  const errorTitle =
    source === "room-join"
      ? "초대 수락은 완료됐지만 대기방 정보를 아직 다시 불러오지 못했어요."
      : "방 생성은 완료됐지만 대기방 정보를 아직 다시 불러오지 못했어요.";

  return (
    <AssistantMessage>
      <p className="main-chat-shell__waiting-badge">대기방 모드</p>
      <p>{errorMessage ? errorTitle : successMessage}</p>
      <p>
        {errorMessage
          ? errorMessage
          : "친구들이 접속중입니다 기다려주세요~"}
      </p>
      <button type="button" className="main-chat-shell__retry" onClick={onRetry}>
        다시 확인
      </button>
    </AssistantMessage>
  );
}

function MainReadyState({
  nickname,
  currentRoom,
  duplicateRoomWarning,
  invitations,
  aiMessages,
  mockScenario,
  shouldShowRoomCreateDifficultyUi,
  shouldShowRoomCreateTemplateUi,
  roomCreateTemplates,
  selectedPresentationTemplate,
  latestRoomCreateDifficulty,
  waitingRoomTransition,
  roomWaitingState,
  isWaitingRoomLoading,
  waitingRoomErrorMessage,
  invitationActionState,
  startButtonNotice,
  isStartRequestPending,
  isStartRequestAccepted,
  hasActiveAiChatSession,
  isAiChatLoading,
  isAiChatSendPending,
  sendErrorMessage,
  composerValue,
  composerDisabled,
  composerPlaceholder,
  aiChatSessionErrorMessage,
  aiChatMessageErrorMessage,
  currentRoomErrorMessage,
  invitationErrorMessage,
  shouldShowEmptyPrompt,
  onComposerChange,
  onComposerSubmit,
  onSelectRoomCreateDifficulty,
  onSelectRoomCreateTemplate,
  onConfirmPresentationRoomCreate,
  onAcceptInvitation,
  onDenyInvitation,
  onRetryInvitationAction,
  onStartGame,
  onResetMockScenario,
  onRetryWaitingRoomTransition,
  onRetryWaitingRoom,
  onRetrySendMessage,
  onRetryAiChatSessions,
  onRetryAiChatMessages,
  onRetryCurrentRoom,
  onRetryInvitations,
}: {
  nickname: string;
  currentRoom: CurrentGameRoom | null;
  duplicateRoomWarning: boolean;
  invitations: GameRoomParticipant[];
  aiMessages: AiChatMessage[];
  mockScenario: string | null;
  shouldShowRoomCreateDifficultyUi: boolean;
  shouldShowRoomCreateTemplateUi: boolean;
  roomCreateTemplates: RoomCreateTemplateOption[];
  selectedPresentationTemplate: RoomCreateTemplateOption | null;
  latestRoomCreateDifficulty: string | null;
  waitingRoomTransition: WaitingRoomTransitionState | null;
  roomWaitingState: RoomWaitingState | null;
  isWaitingRoomLoading: boolean;
  waitingRoomErrorMessage: string | null;
  invitationActionState: {
    participantId: string;
    action: InvitationActionType;
    errorMessage: string | null;
    retryable: boolean;
  } | null;
  startButtonNotice: string | null;
  isStartRequestPending: boolean;
  isStartRequestAccepted: boolean;
  hasActiveAiChatSession: boolean;
  isAiChatLoading: boolean;
  isAiChatSendPending: boolean;
  sendErrorMessage: string | null;
  composerValue: string;
  composerDisabled: boolean;
  composerPlaceholder: string;
  aiChatSessionErrorMessage: string | null;
  aiChatMessageErrorMessage: string | null;
  currentRoomErrorMessage: string | null;
  invitationErrorMessage: string | null;
  shouldShowEmptyPrompt: boolean;
  onComposerChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onComposerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSelectRoomCreateDifficulty: (difficulty: RoomCreateDifficulty) => void;
  onSelectRoomCreateTemplate: (template: RoomCreateTemplateOption) => void;
  onConfirmPresentationRoomCreate: () => void;
  onAcceptInvitation: (invitation: GameRoomParticipant) => void;
  onDenyInvitation: (invitation: GameRoomParticipant) => void;
  onRetryInvitationAction: () => void;
  onStartGame: () => void;
  onResetMockScenario: () => void;
  onRetryWaitingRoomTransition: () => void;
  onRetryWaitingRoom: () => void;
  onRetrySendMessage: () => void;
  onRetryAiChatSessions: () => void;
  onRetryAiChatMessages: () => void;
  onRetryCurrentRoom: () => void;
  onRetryInvitations: () => void;
}) {
  const hasCurrentRoom = Boolean(currentRoom);
  const hasInvitations = invitations.length > 0;
  const shouldHidePresentationOwnerWaitingRoom =
    mockScenario === "presentation-owner" &&
    currentRoom?.joinedParticipantCount === 1;
  const hasVisibleCurrentRoom = hasCurrentRoom && !shouldHidePresentationOwnerWaitingRoom;

  return (
    <div className="main-chat-shell">
      <div className="main-chat-shell__body">
        {mockScenario && !isPresentationMockScenario(mockScenario) ? (
          <MainMockModeNotice scenario={mockScenario} onReset={onResetMockScenario} />
        ) : null}

        {isAiChatLoading ? <MainChatLoadingBubbles /> : null}

        {aiMessages.length > 0
          ? aiMessages.map((message) => (
              <ChatHistoryMessage key={message.messageId} message={message} />
            ))
          : null}

        {isAiChatSendPending ? (
          <AssistantMessage>
            <p>AI 마스터가 답변을 준비하고 있어요.</p>
          </AssistantMessage>
        ) : null}

        {shouldShowEmptyPrompt ? (
          <AssistantMessage>
            <p>안녕하세요! AI 마스터입니다. 😊</p>
            <p>{nickname}님, 네코내코에 오신 것을 환영해요!</p>
            <p>현재 참여하고있는 방이 없어요.</p>
            <p>방을 만들고 친구를 초대해보세요!</p>
          </AssistantMessage>
        ) : null}

        {hasVisibleCurrentRoom || hasInvitations ? (
          <AssistantMessage timestamp={currentRoom?.updatedAt ?? invitations[0]?.createdAt}>
            <p>현재 서버 상태를 바탕으로 방 정보와 초대장을 불러왔어요.</p>
          </AssistantMessage>
        ) : null}

        {duplicateRoomWarning ? (
          <AssistantMessage timestamp={currentRoom?.updatedAt}>
            <p className="main-chat-shell__warning">
              여러 개의 현재 방이 감지되어 가장 최근 방을 우선 표시하고 있어요.
            </p>
          </AssistantMessage>
        ) : null}

        {currentRoom?.status === "WAITING" && !shouldHidePresentationOwnerWaitingRoom ? (
          <WaitingRoomModeNotice room={currentRoom} />
        ) : null}

        {!currentRoom && waitingRoomTransition ? (
          <WaitingRoomTransitionNotice
            source={waitingRoomTransition.source}
            errorMessage={waitingRoomTransition.errorMessage}
            onRetry={onRetryWaitingRoomTransition}
          />
        ) : null}

        {currentRoom &&
        currentRoom.status === "WAITING" &&
        !shouldHidePresentationOwnerWaitingRoom &&
        (isWaitingRoomLoading || roomWaitingState) ? (
          <AssistantMessage timestamp={currentRoom.updatedAt}>
            <p>현재 참여 중인 대기방 상태를 정리했어요.</p>
            {isWaitingRoomLoading ? (
              <WaitingRoomLoadingState />
            ) : roomWaitingState ? (
              <WaitingRoomStatusSection
                roomWaitingState={roomWaitingState}
                startButtonNotice={startButtonNotice}
                isStartRequestPending={isStartRequestPending}
                isStartRequestAccepted={isStartRequestAccepted}
                onStartGame={onStartGame}
              />
            ) : null}
          </AssistantMessage>
        ) : null}

        {waitingRoomErrorMessage ? (
          <MainPartialErrorState
            title="대기방 참가자 상태를 다시 불러오지 못했어요."
            message={waitingRoomErrorMessage}
            onRetry={onRetryWaitingRoom}
          />
        ) : null}

        {currentRoom && currentRoom.status !== "WAITING" ? (
          <AssistantMessage timestamp={currentRoom.updatedAt}>
            <p>현재 참여 중인 방을 찾았어요.</p>
            <CurrentRoomSummary room={currentRoom} />
          </AssistantMessage>
        ) : null}

        {!hasCurrentRoom && shouldShowRoomCreateDifficultyUi ? (
          <RoomCreateDifficultySelector
            disabled={isAiChatSendPending}
            onSelect={onSelectRoomCreateDifficulty}
          />
        ) : null}

        {!hasCurrentRoom && shouldShowRoomCreateTemplateUi && !selectedPresentationTemplate ? (
          <RoomCreateTemplateSelector
            templates={roomCreateTemplates}
            selectedDifficulty={latestRoomCreateDifficulty}
            disabled={isAiChatSendPending}
            onSelect={onSelectRoomCreateTemplate}
          />
        ) : null}

        {!hasCurrentRoom && selectedPresentationTemplate ? (
          <RoomCreateConfirmation
            template={selectedPresentationTemplate}
            disabled={isAiChatSendPending}
            onConfirm={onConfirmPresentationRoomCreate}
          />
        ) : null}

        {currentRoomErrorMessage ? (
          <MainPartialErrorState
            title="현재 방 정보를 다시 불러오지 못했어요."
            message={currentRoomErrorMessage}
            onRetry={onRetryCurrentRoom}
          />
        ) : null}

        {hasInvitations ? (
          <AssistantMessage timestamp={invitations[0].createdAt}>
            <p>도착한 초대장을 확인해보세요.</p>
            <div className="main-invitation-list">
              {invitations.map((invitation) => (
                <InvitationCard
                  key={invitation.participantId}
                  invitation={invitation}
                  actionState={
                    invitationActionState?.participantId === invitation.participantId
                      ? invitationActionState
                      : null
                  }
                  disabled={isAiChatSendPending}
                  onAccept={() => {
                    onAcceptInvitation(invitation);
                  }}
                  onDeny={() => {
                    onDenyInvitation(invitation);
                  }}
                  onRetry={onRetryInvitationAction}
                />
              ))}
            </div>
          </AssistantMessage>
        ) : null}

        {invitationErrorMessage ? (
          <MainPartialErrorState
            title="초대장 목록을 다시 불러오지 못했어요."
            message={invitationErrorMessage}
            onRetry={onRetryInvitations}
          />
        ) : null}

        {aiChatSessionErrorMessage ? (
          <MainPartialErrorState
            title="AI 채팅 세션 목록을 다시 불러오지 못했어요."
            message={aiChatSessionErrorMessage}
            onRetry={onRetryAiChatSessions}
          />
        ) : null}

        {aiChatMessageErrorMessage ? (
          <MainPartialErrorState
            title="AI 채팅 메시지를 다시 불러오지 못했어요."
            message={aiChatMessageErrorMessage}
            onRetry={onRetryAiChatMessages}
          />
        ) : null}

        {sendErrorMessage ? (
          <MainPartialErrorState
            title="메시지를 보내지 못했어요."
            message={sendErrorMessage}
            onRetry={onRetrySendMessage}
          />
        ) : null}

        {shouldShowEmptyPrompt ? (
          <AssistantMessage>
            <p>
              {hasActiveAiChatSession
                ? "메시지 입력창을 통해 게임 방 생성 요청을 보낼 수 있어요."
                : "활성 채팅 세션이 아직 준비되지 않아 입력창을 잠시 비활성화했어요."}
            </p>
            <p>
              {hasActiveAiChatSession
                ? "예를 들어 '방 만들어줘'처럼 자연스럽게 요청해보세요."
                : "채팅 세션을 다시 불러오면 AI 룸 생성 흐름을 이어갈 수 있어요."}
            </p>
          </AssistantMessage>
        ) : null}

        {shouldShowEmptyPrompt && !hasActiveAiChatSession && !aiChatSessionErrorMessage ? (
          <MainPartialErrorState
            title="활성 AI 채팅 세션을 찾지 못했어요."
            message="채팅 세션을 다시 불러온 뒤 다시 시도해주세요."
            onRetry={onRetryAiChatSessions}
          />
        ) : null}
      </div>

      <MainChatComposer
        value={composerValue}
        placeholder={composerPlaceholder}
        disabled={composerDisabled}
        isPending={isAiChatSendPending}
        onChange={onComposerChange}
        onSubmit={onComposerSubmit}
      />
    </div>
  );
}

function MainScrollDebugState({ nickname }: { nickname: string }) {
  const messages = Array.from({ length: 18 }, (_, index) => ({
    id: `debug-message-${index + 1}`,
    timestamp: `2026-05-25T12:${String((index * 3) % 60).padStart(2, "0")}:00`,
    content:
      index % 2 === 0
        ? "스크롤 동작 확인용 더미 메시지입니다. 채팅이 길어져도 바깥 페이지가 아니라 이 채팅 영역 안에서만 스크롤되어야 합니다."
        : "입력창은 아래에 계속 붙어 있고, 헤더와 사이드바도 제자리를 유지하는지 같이 확인해보세요.",
  }));

  return (
    <div className="main-chat-shell">
      <div className="main-chat-shell__body">
        <AssistantMessage timestamp="2026-05-25T12:00:00">
          <p>안녕하세요! AI 마스터입니다. 😊</p>
          <p>{nickname}님, 지금은 채팅 스크롤 확인용 디버그 모드예요.</p>
        </AssistantMessage>

        {messages.map((message, index) => (
          <AssistantMessage key={message.id} timestamp={message.timestamp}>
            <p>
              <strong>테스트 메시지 {index + 1}</strong>
            </p>
            <p>{message.content}</p>
          </AssistantMessage>
        ))}
      </div>

      <MainChatComposer
        value=""
        placeholder="스크롤 테스트용 입력창입니다."
        disabled
        isPending={false}
      />
    </div>
  );
}

type WaitingRoomTransitionState = {
  source: "room-create" | "room-join";
  gameRoomId: string;
  errorMessage: string | null;
};

type InvitationActionState = {
  participantId: string;
  action: InvitationActionType;
  errorMessage: string | null;
  retryable: boolean;
  submittedMessage: string;
};

export function MainPage() {
  const navigate = useNavigate();
  const store = useAppStoreApi();
  const user = useAppStore((state) => state.auth.user);
  const aiChatState = useAppStore((state) => state.aiChat);
  const storedRoomWaitingState = useAppStore((state) => state.room.roomWaitingState);
  const [composerValue, setComposerValue] = useState("");
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [waitingRoomTransition, setWaitingRoomTransition] =
    useState<WaitingRoomTransitionState | null>(null);
  const [hiddenInvitationIds, setHiddenInvitationIds] = useState<string[]>([]);
  const [invitationActionState, setInvitationActionState] =
    useState<InvitationActionState | null>(null);
  const [startButtonNotice, setStartButtonNotice] = useState<string | null>(null);
  const [isStartRequestAccepted, setIsStartRequestAccepted] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [selectedPresentationTemplate, setSelectedPresentationTemplate] =
    useState<RoomCreateTemplateOption | null>(null);
  const [mockInstanceId] = useState(
    () => `main-page-mock-${Math.random().toString(36).slice(2, 10)}`,
  );
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const search =
    typeof window !== "undefined" ? window.location.search : "";
  const isScrollDebugMode =
    typeof window !== "undefined" &&
    new URLSearchParams(search).get("debug") === "scroll";
  const mockScenario = getMainPageMockScenario(search);
  const mainPageMockApi = mockScenario
    ? createMainPageMockApi(mockScenario, mockInstanceId)
    : null;
  const effectiveUser = mockScenario ? getMainPageMockUser(mockScenario) : user;

  const currentRoomQuery = useQuery({
    queryKey: ["main-page-current-room", effectiveUser?.userId, mockScenario],
    enabled: Boolean(effectiveUser?.userId) && !isScrollDebugMode,
    queryFn: () =>
      loadCurrentRoomState({
        userId: effectiveUser?.userId ?? "",
        getCurrentRooms: mainPageMockApi?.getCurrentRooms ?? gameRoomApi.getCurrentRooms,
        onDuplicateRoomsDetected(rooms) {
          console.warn(
            "[MainPage] Multiple current rooms detected. Using the most recently updated room.",
            rooms.map((room) => room.gameRoomId),
          );
        },
      }),
  });

  const invitationQuery = useQuery({
    queryKey: ["main-page-invitations", effectiveUser?.userId, mockScenario],
    enabled: Boolean(effectiveUser?.userId) && !isScrollDebugMode,
    queryFn: () =>
      loadInvitations({
        userId: effectiveUser?.userId ?? "",
        getInvitedParticipants:
          mainPageMockApi?.getInvitedParticipants ?? invitationApi.getInvitedParticipants,
      }),
  });

  useEffect(() => {
    if (currentRoomQuery.data === undefined) {
      return;
    }

    store.setState((state) => ({
      ...state,
      room: {
        ...state.room,
        currentRoom: currentRoomQuery.data.currentRoom,
        duplicateRoomWarning: currentRoomQuery.data.duplicateRoomWarning,
      },
    }));
  }, [currentRoomQuery.data, store]);

  useEffect(() => {
    if (invitationQuery.data === undefined) {
      return;
    }

    store.setState((state) => ({
      ...state,
      room: {
        ...state.room,
        invitations: invitationQuery.data,
      },
    }));
  }, [invitationQuery.data, store]);

  const mainPageView = deriveMainPageInitializationView({
    currentRoomQuery: {
      data: currentRoomQuery.data,
      error: currentRoomQuery.error,
      isPending: currentRoomQuery.isPending,
    },
    invitationQuery: {
      data: invitationQuery.data,
      error: invitationQuery.error,
      isPending: invitationQuery.isPending,
    },
  });
  const visibleInvitations = mainPageView.invitations.filter(
    (invitation) => !hiddenInvitationIds.includes(invitation.participantId),
  );
  const waitingRoomCurrentRoom =
    mainPageView.currentRoomState.currentRoom?.status === "WAITING"
      ? mainPageView.currentRoomState.currentRoom
      : null;
  const aiChatSessionQuery = useQuery({
    queryKey: ["main-page-ai-chat-sessions", effectiveUser?.userId, mockScenario],
    enabled: Boolean(effectiveUser?.userId) && !isScrollDebugMode,
    queryFn: () =>
      loadAiChatSessions({
        userId: effectiveUser?.userId ?? "",
        getSessions: mainPageMockApi?.getSessions ?? aiChatApi.getSessions,
      }),
  });
  const aiChatView = deriveMainPageAiChatView({
    currentRoom: mainPageView.currentRoomState.currentRoom,
    invitations: visibleInvitations,
    sessionQuery: {
      data: aiChatSessionQuery.data,
      error: aiChatSessionQuery.error,
      isPending: aiChatSessionQuery.isPending,
    },
    messageQuery: {
      data: undefined,
      error: null,
      isPending: false,
    },
  });
  const aiChatMessageQuery = useQuery({
    queryKey: ["main-page-ai-chat-messages", aiChatView.activeSession?.aiChatSessionId],
    enabled: Boolean(aiChatView.activeSession?.aiChatSessionId) && !isScrollDebugMode,
    queryFn: () =>
      loadAiChatMessages({
        aiChatSessionId: aiChatView.activeSession?.aiChatSessionId ?? "",
        getMessages: mainPageMockApi?.getMessages ?? aiChatApi.getMessages,
      }),
  });
  const finalAiChatView = deriveMainPageAiChatView({
    currentRoom: mainPageView.currentRoomState.currentRoom,
    invitations: visibleInvitations,
    sessionQuery: {
      data: aiChatSessionQuery.data,
      error: aiChatSessionQuery.error,
      isPending: aiChatSessionQuery.isPending,
    },
    messageQuery: {
      data: aiChatMessageQuery.data,
      error: aiChatMessageQuery.error,
      isPending: aiChatMessageQuery.isPending,
    },
  });
  const activeSessionId = finalAiChatView.activeSession?.aiChatSessionId ?? null;
  // Prefer server-provided messages when available (ensures metadata/templates
  // returned by the backend are recognized), otherwise fall back to locally
  // stored optimistic messages tied to the active session.
  const aiMessages =
    aiChatMessageQuery.data !== undefined
      ? finalAiChatView.messages
      : activeSessionId && aiChatState.activeSessionId === activeSessionId
      ? aiChatState.messages
      : finalAiChatView.messages;
  const roomCreateTemplates = extractRoomCreateTemplateOptions({
    messages: aiMessages,
    pendingRequestId: aiChatState.pendingRequestId,
  });
  const latestRoomCreateDifficulty = extractLatestRoomCreateDifficultyForRequest({
    messages: aiMessages,
    pendingRequestId: aiChatState.pendingRequestId,
  });
  const shouldShowRoomCreateTemplateUi =
    aiChatState.pendingCommand?.commandType === "ROOM_CREATE" &&
    aiChatState.pendingCommand.status === "PENDING" &&
    roomCreateTemplates.length > 0;
  const shouldShowRoomCreateDifficultyUi = shouldShowRoomCreateDifficultySelection(
    aiChatState.pendingCommand,
    roomCreateTemplates,
  );
  const roomWaitingParticipantsQuery = useQuery({
    queryKey: ["main-page-room-waiting", waitingRoomCurrentRoom?.gameRoomId, mockScenario],
    enabled: Boolean(waitingRoomCurrentRoom?.gameRoomId) && !isScrollDebugMode,
    queryFn: () =>
      (
        mainPageMockApi?.getRoomParticipants ?? roomWaitingApi.getParticipants
      )(waitingRoomCurrentRoom?.gameRoomId ?? ""),
  });
  const waitingRoomErrorMessage =
    waitingRoomCurrentRoom &&
    roomWaitingParticipantsQuery.error &&
    !roomWaitingParticipantsQuery.data
      ? getUserFacingErrorMessage(roomWaitingParticipantsQuery.error)
      : null;
  const roomWaitingState =
    storedRoomWaitingState?.currentRoom.gameRoomId === waitingRoomCurrentRoom?.gameRoomId
      ? storedRoomWaitingState
      : null;

  useEffect(() => {
    if (mockScenario !== "presentation-owner") {
      return;
    }

    function handlePresentationGuestJoin(event: StorageEvent) {
      if (event.key !== PRESENTATION_MOCK_STORAGE_KEY || event.newValue !== "true") {
        return;
      }

      void Promise.all([
        currentRoomQuery.refetch(),
        roomWaitingParticipantsQuery.refetch(),
        aiChatMessageQuery.refetch(),
      ]);
    }

    window.addEventListener("storage", handlePresentationGuestJoin);

    return () => {
      window.removeEventListener("storage", handlePresentationGuestJoin);
    };
  }, [
    aiChatMessageQuery,
    currentRoomQuery,
    mockScenario,
    roomWaitingParticipantsQuery,
  ]);

  useEffect(() => {
    if (mockScenario !== "presentation-guest") {
      return;
    }

    function handlePresentationInvite(event: StorageEvent) {
      if (event.key !== PRESENTATION_INVITES_STORAGE_KEY) {
        return;
      }

      void Promise.all([
        invitationQuery.refetch(),
        aiChatMessageQuery.refetch(),
      ]);
    }

    window.addEventListener("storage", handlePresentationInvite);

    return () => {
      window.removeEventListener("storage", handlePresentationInvite);
    };
  }, [aiChatMessageQuery, invitationQuery, mockScenario]);

  useEffect(() => {
    if (invitationQuery.data === undefined) {
      return;
    }

    setHiddenInvitationIds((previousIds) =>
      previousIds.filter((participantId) =>
        invitationQuery.data?.some((invitation) => invitation.participantId === participantId),
      ),
    );
  }, [invitationQuery.data]);

  useEffect(() => {
    setSendErrorMessage(null);
    setFailedMessage(null);
    setComposerValue("");
    setWaitingRoomTransition(null);
    setHiddenInvitationIds([]);
    setInvitationActionState(null);
    setStartButtonNotice(null);
    setIsStartRequestAccepted(false);
    setSelectedPresentationTemplate(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (
      waitingRoomTransition &&
      mainPageView.currentRoomState.currentRoom?.gameRoomId === waitingRoomTransition.gameRoomId
    ) {
      setWaitingRoomTransition(null);
    }
  }, [mainPageView.currentRoomState.currentRoom?.gameRoomId, waitingRoomTransition]);

  useEffect(() => {
    setStartButtonNotice(null);
    setIsStartRequestAccepted(false);
    setSelectedPresentationTemplate(null);
  }, [waitingRoomCurrentRoom?.gameRoomId]);

  useEffect(() => {
    if (isScrollDebugMode) {
      return;
    }

    store.setState((state) => ({
      ...state,
      aiChat: syncAiChatSessionSelection({
        previousState: state.aiChat,
        activeSessionId: finalAiChatView.activeSession?.aiChatSessionId ?? null,
      }),
    }));
  }, [finalAiChatView.activeSession?.aiChatSessionId, isScrollDebugMode, store]);

  useEffect(() => {
    if (isScrollDebugMode || aiChatMessageQuery.data === undefined) {
      return;
    }

    store.setState((state) => ({
      ...state,
      aiChat: syncAiChatMessages({
        previousState: state.aiChat,
        activeSessionId: finalAiChatView.activeSession?.aiChatSessionId ?? null,
        messages: aiChatMessageQuery.data,
      }),
    }));
  }, [
    aiChatMessageQuery.data,
    finalAiChatView.activeSession?.aiChatSessionId,
    isScrollDebugMode,
    store,
  ]);

  useEffect(() => {
    if (!waitingRoomCurrentRoom) {
      store.setState((state) => ({
        ...state,
        room: {
          ...state.room,
          roomWaitingState: null,
        },
      }));
      return;
    }

    if (roomWaitingParticipantsQuery.data === undefined || !effectiveUser) {
      return;
    }

    store.setState((state) => ({
      ...state,
      room: {
        ...state.room,
        roomWaitingState: buildRoomWaitingState({
          currentRoom: waitingRoomCurrentRoom,
          participants: roomWaitingParticipantsQuery.data,
          previousState: state.room.roomWaitingState,
          currentUser: {
            userId: effectiveUser.userId,
            nickname: effectiveUser.nickname,
          },
        }),
      },
    }));
  }, [
    effectiveUser,
    roomWaitingParticipantsQuery.data,
    store,
    waitingRoomCurrentRoom,
  ]);

  const sendMessageMutation = useMutation({
    mutationFn: ({
      aiChatSessionId,
      message,
      invitationAction,
    }: {
      aiChatSessionId: string;
      message: string;
      invitationAction?: {
        participantId: string;
        action: InvitationActionType;
      };
    }) =>
      (mainPageMockApi?.sendMessage ?? aiChatApi.sendMessage)(aiChatSessionId, { message }),
    onMutate(variables) {
      setSendErrorMessage(null);
      setFailedMessage(null);

      if (variables.invitationAction) {
        setInvitationActionState({
          participantId: variables.invitationAction.participantId,
          action: variables.invitationAction.action,
          errorMessage: null,
          retryable: true,
          submittedMessage: variables.message,
        });
      }
    },
    async onSuccess(response, variables) {
      setComposerValue("");
      setFailedMessage(null);
      setSendErrorMessage(null);
      setInvitationActionState(null);
      store.setState((state) => ({
        ...state,
        aiChat: syncSentAiChatResponse({
          previousState: state.aiChat,
          activeSessionId: variables.aiChatSessionId,
          response,
        }),
      }));

      const storedInvitations = store.getState().room.invitations;
      const completedInvitationIds = resolveCompletedInvitationIds({
        invitations: storedInvitations,
        response,
      });

      if (completedInvitationIds.length > 0) {
        setHiddenInvitationIds((previousIds) => [
          ...new Set([...previousIds, ...completedInvitationIds]),
        ]);
        store.setState((state) => ({
          ...state,
          room: {
            ...state.room,
            invitations: state.room.invitations.filter(
              (invitation) => !completedInvitationIds.includes(invitation.participantId),
            ),
          },
        }));
      }

      if (
        (response.requestType === "ROOM_CREATE" || response.requestType === "ROOM_JOIN") &&
        response.commandResult?.status === "SUCCESS" &&
        response.commandResult.gameRoomId
      ) {
        setWaitingRoomTransition({
          source: response.requestType === "ROOM_JOIN" ? "room-join" : "room-create",
          gameRoomId: response.commandResult.gameRoomId,
          errorMessage: null,
        });
      }

      const [currentRoomResult] = await Promise.all([
        currentRoomQuery.refetch(),
        invitationQuery.refetch(),
        aiChatSessionQuery.refetch(),
        aiChatMessageQuery.refetch(),
        roomWaitingParticipantsQuery.refetch(),
      ]);

      if (
        (response.requestType === "ROOM_CREATE" || response.requestType === "ROOM_JOIN") &&
        response.commandResult?.status === "SUCCESS" &&
        response.commandResult.gameRoomId &&
        currentRoomResult.data?.currentRoom?.gameRoomId !== response.commandResult.gameRoomId
      ) {
        setWaitingRoomTransition({
          source: response.requestType === "ROOM_JOIN" ? "room-join" : "room-create",
          gameRoomId: response.commandResult.gameRoomId,
          errorMessage: currentRoomResult.error
            ? getUserFacingErrorMessage(currentRoomResult.error)
            : null,
        });
      }
    },
    onError(error, variables) {
      if (variables.invitationAction) {
        setInvitationActionState({
          participantId: variables.invitationAction.participantId,
          action: variables.invitationAction.action,
          errorMessage: getUserFacingErrorMessage(error),
          retryable: isRetryableInvitationActionError(error),
          submittedMessage: variables.message,
        });
        return;
      }

      setFailedMessage(variables.message);
      setSendErrorMessage(getUserFacingErrorMessage(error));
    },
  });

  const startGameMutation = useMutation({
    mutationFn: ({ gameRoomId }: { gameRoomId: string }) =>
      mockScenario
        ? mainPageMockApi?.startGame(gameRoomId) ?? Promise.resolve({ success: false })
        : gameRoomApi.startGame(gameRoomId, {}),
    onMutate() {
      setStartButtonNotice(null);
      setIsStartRequestAccepted(false);
    },
    onSuccess(response) {
      if (response.success) {
        setIsStartRequestAccepted(true);
        setStartButtonNotice(
          "게임 시작 요청을 보냈어요!",
        );
        if (waitingRoomCurrentRoom && isPresentationMockScenario(mockScenario)) {
          navigate(
            `/rooms/${encodeURIComponent(waitingRoomCurrentRoom.gameRoomId)}/play?mock=${mockScenario}`,
          );
        }
        return;
      }

      setStartButtonNotice("게임 시작 요청이 아직 접수되지 않았어요. 다시 시도해주세요.");
    },
    onError(error) {
      setStartButtonNotice(
        getUserFacingErrorMessage(error, "게임 시작 요청을 보내지 못했어요."),
      );
      setIsStartRequestAccepted(false);
    },
  });

  async function submitAiChatMessage(
    message: string,
    options?: {
      invitationAction?: {
        participantId: string;
        action: InvitationActionType;
      };
    },
  ) {
    const trimmedMessage = message.trim();

    if (!activeSessionId || !trimmedMessage || sendMessageMutation.isPending) {
      return;
    }

    try {
      await sendMessageMutation.mutateAsync({
        aiChatSessionId: activeSessionId,
        message: trimmedMessage,
        invitationAction: options?.invitationAction,
      });
    } catch {
      // React Query already routes the failure through onError for UI state updates.
    }
  }

  function handleComposerChange(event: ChangeEvent<HTMLInputElement>) {
    setComposerValue(event.currentTarget.value);
    setSendErrorMessage(null);
    setFailedMessage(null);
  }

  async function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAiChatMessage(composerValue);
  }

  async function retryFailedSend() {
    if (!failedMessage) {
      return;
    }

    await submitAiChatMessage(failedMessage);
  }

  async function retryWaitingRoomTransition() {
    if (!waitingRoomTransition) {
      return;
    }

    const result = await currentRoomQuery.refetch();

    if (result.data?.currentRoom?.gameRoomId === waitingRoomTransition.gameRoomId) {
      setWaitingRoomTransition(null);
      return;
    }

    setWaitingRoomTransition({
      ...waitingRoomTransition,
      errorMessage: result.error ? getUserFacingErrorMessage(result.error) : null,
    });
  }

  async function retryWaitingRoom() {
    await roomWaitingParticipantsQuery.refetch();
  }

  async function resetMockScenario() {
    if (!mainPageMockApi) {
      return;
    }

    mainPageMockApi.reset();
    setComposerValue("");
    setSendErrorMessage(null);
    setFailedMessage(null);
    setWaitingRoomTransition(null);
    setHiddenInvitationIds([]);
    setInvitationActionState(null);
    setStartButtonNotice(null);
    setIsStartRequestAccepted(false);
    store.setState((state) => ({
      ...state,
      aiChat: {
        activeSessionId: null,
        messages: [],
        pendingCommand: null,
        pendingRequestId: null,
      },
      room: {
        ...state.room,
        currentRoom: null,
        duplicateRoomWarning: false,
        invitations: [],
        roomWaitingState: null,
      },
    }));
    await Promise.all([
      currentRoomQuery.refetch(),
      invitationQuery.refetch(),
      aiChatSessionQuery.refetch(),
      aiChatMessageQuery.refetch(),
    ]);
  }

  function handleRoomCreateDifficultySelect(difficulty: RoomCreateDifficulty) {
    void submitAiChatMessage(buildRoomCreateDifficultyMessage(difficulty));
  }

  function handleRoomCreateTemplateSelect(template: RoomCreateTemplateOption) {
    if (mockScenario === "presentation-owner") {
      setSelectedPresentationTemplate(template);
      return;
    }

    void submitAiChatMessage(buildRoomCreateTemplateConfirmationMessage(template));
  }

  function handleConfirmPresentationRoomCreate() {
    if (!selectedPresentationTemplate) {
      return;
    }

    void submitAiChatMessage(
      buildRoomCreateTemplateConfirmationMessage(selectedPresentationTemplate),
    );
    setSelectedPresentationTemplate(null);
  }

  function handleInvitationAccept(invitation: GameRoomParticipant) {
    void submitAiChatMessage(buildInvitationAcceptMessage(invitation), {
      invitationAction: {
        participantId: invitation.participantId,
        action: "accept",
      },
    });
  }

  function handleInvitationDeny(invitation: GameRoomParticipant) {
    void submitAiChatMessage(buildInvitationDenyMessage(invitation), {
      invitationAction: {
        participantId: invitation.participantId,
        action: "deny",
      },
    });
  }

  async function retryInvitationAction() {
    if (!invitationActionState) {
      return;
    }

    await submitAiChatMessage(invitationActionState.submittedMessage, {
      invitationAction: {
        participantId: invitationActionState.participantId,
        action: invitationActionState.action,
      },
    });
  }

  async function handleStartGame() {
    if (!waitingRoomCurrentRoom || startGameMutation.isPending || isStartRequestAccepted) {
      return;
    }

    try {
      await startGameMutation.mutateAsync({
        gameRoomId: waitingRoomCurrentRoom.gameRoomId,
      });
    } catch {
      // React Query already routes the failure through onError for UI state updates.
    }
  }

  const composerDisabled =
    !activeSessionId || finalAiChatView.status === "loading" || sendMessageMutation.isPending;
  const composerPlaceholder = !activeSessionId
    ? "활성 채팅 세션을 불러오는 중이에요."
    : finalAiChatView.status === "loading"
      ? "이전 대화를 불러오는 중이에요."
      : sendMessageMutation.isPending
      ? "AI 마스터가 답변을 준비하고 있어요..."
      : "메시지를 입력하세요... (예: 방 만들어줘)";

  useEffect(() => {
    if (!isUserMenuOpen || typeof window === "undefined") {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserMenuOpen]);

  return (
    <main className="main-screen">
      <div className="main-screen__frame">
        <header className="main-screen__topbar">
          <span className="signup-screen__logo">
            네코네코<span className="signup-screen__logo-paw">✿</span>
          </span>

          <div className="main-screen__topbar-actions">
            <div className="main-user-menu" ref={userMenuRef}>
              <button
                type="button"
                className={`main-user-chip${isUserMenuOpen ? " main-user-chip--open" : ""}`}
                aria-label="User menu"
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                onClick={() => setIsUserMenuOpen((isOpen) => !isOpen)}
              >
                <UserAvatar label={effectiveUser?.nickname ?? "사용자"} />
                <span className="main-user-chip__name">{effectiveUser?.nickname ?? "사용자"}</span>
                <ChevronDownIcon />
              </button>

              {isUserMenuOpen ? (
                <div className="main-user-menu__popover" role="menu">
                  <button
                    type="button"
                    className="main-user-menu__logout"
                    role="menuitem"
                    onClick={notifyAuthLogout}
                  >
                    로그아웃
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="main-screen__workspace">
          <MainGuideSidebar />

          {isScrollDebugMode ? (
            <MainScrollDebugState nickname={effectiveUser?.nickname ?? "플레이어"} />
          ) : null}
          {!isScrollDebugMode && mainPageView.status === "loading" ? (
            <MainLoadingState />
          ) : null}
          {!isScrollDebugMode && mainPageView.status === "error" ? (
            <MainErrorState
              message={mainPageView.blockingErrorMessage ?? "초기화에 실패했어요."}
              onRetry={() => {
                void currentRoomQuery.refetch();
                void invitationQuery.refetch();
              }}
            />
          ) : null}
          {!isScrollDebugMode && mainPageView.status === "ready" ? (
            <MainReadyState
              nickname={effectiveUser?.nickname ?? "플레이어"}
              currentRoom={mainPageView.currentRoomState.currentRoom}
              duplicateRoomWarning={mainPageView.currentRoomState.duplicateRoomWarning}
              invitations={visibleInvitations}
              aiMessages={aiMessages}
              mockScenario={mockScenario}
              shouldShowRoomCreateDifficultyUi={shouldShowRoomCreateDifficultyUi}
              shouldShowRoomCreateTemplateUi={shouldShowRoomCreateTemplateUi}
              roomCreateTemplates={roomCreateTemplates}
              selectedPresentationTemplate={selectedPresentationTemplate}
              latestRoomCreateDifficulty={latestRoomCreateDifficulty}
              waitingRoomTransition={waitingRoomTransition}
              roomWaitingState={roomWaitingState}
              isWaitingRoomLoading={
                Boolean(waitingRoomCurrentRoom) &&
                roomWaitingParticipantsQuery.isPending &&
                !roomWaitingState
              }
              waitingRoomErrorMessage={waitingRoomErrorMessage}
              invitationActionState={
                invitationActionState
                  ? {
                      participantId: invitationActionState.participantId,
                      action: invitationActionState.action,
                      errorMessage: invitationActionState.errorMessage,
                      retryable: invitationActionState.retryable,
                    }
                  : null
              }
              startButtonNotice={startButtonNotice}
              isStartRequestPending={startGameMutation.isPending}
              isStartRequestAccepted={isStartRequestAccepted}
              hasActiveAiChatSession={Boolean(activeSessionId)}
              isAiChatLoading={finalAiChatView.status === "loading"}
              isAiChatSendPending={sendMessageMutation.isPending}
              sendErrorMessage={sendErrorMessage}
              composerValue={composerValue}
              composerDisabled={composerDisabled}
              composerPlaceholder={composerPlaceholder}
              aiChatSessionErrorMessage={finalAiChatView.sessionErrorMessage}
              aiChatMessageErrorMessage={finalAiChatView.messageErrorMessage}
              currentRoomErrorMessage={mainPageView.currentRoomErrorMessage}
              invitationErrorMessage={mainPageView.invitationErrorMessage}
              shouldShowEmptyPrompt={finalAiChatView.shouldShowEmptyPrompt}
              onComposerChange={handleComposerChange}
              onComposerSubmit={handleComposerSubmit}
              onSelectRoomCreateDifficulty={handleRoomCreateDifficultySelect}
              onSelectRoomCreateTemplate={handleRoomCreateTemplateSelect}
              onConfirmPresentationRoomCreate={handleConfirmPresentationRoomCreate}
              onAcceptInvitation={handleInvitationAccept}
              onDenyInvitation={handleInvitationDeny}
              onRetryInvitationAction={() => {
                void retryInvitationAction();
              }}
              onStartGame={() => {
                void handleStartGame();
              }}
              onResetMockScenario={() => {
                void resetMockScenario();
              }}
              onRetryWaitingRoomTransition={() => {
                void retryWaitingRoomTransition();
              }}
              onRetryWaitingRoom={() => {
                void retryWaitingRoom();
              }}
              onRetrySendMessage={() => {
                void retryFailedSend();
              }}
              onRetryAiChatSessions={() => {
                void aiChatSessionQuery.refetch();
              }}
              onRetryAiChatMessages={() => {
                void aiChatMessageQuery.refetch();
              }}
              onRetryCurrentRoom={() => {
                void currentRoomQuery.refetch();
              }}
              onRetryInvitations={() => {
                void invitationQuery.refetch();
              }}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
