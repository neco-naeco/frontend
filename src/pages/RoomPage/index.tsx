import {
  findGameItem,
  gameItemDescription,
  gameItemLabel,
  gameItemTypes,
  itemDisabledReason,
  unlockRequirementLabel,
} from "../../features/game-items/gameItemState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./RoomPage.css";
import { useAppStore, useAppStoreApi } from "../../app/providers/ClientStateProvider";
import {
  getRealtimeCloseBannerCopy,
  isRoomSessionUnavailable,
} from "../../features/realtime/roomSocketLifecycle";
import { applyEditorFileReset } from "../../features/editor/editorTurnBaseline";
import { promoteSubmittedSnapshotToAuthoritative } from "../../features/editor/authoritativeEditorSync";
import { useGameplayCodeSync } from "../../features/editor/useGameplayCodeSync";
import { applyEditorIndentKey } from "../../features/editor/editorIndentation";
import { buildTurnCodeSnapshot } from "../../features/game-turn/buildTurnCodeSnapshot";
import { submitTurn } from "../../features/game-turn/submitTurn";
import { gameRoomApi } from "../../features/game-room/gameRoomApi";
import { listTeamChatMessages } from "../../features/team-chat/teamChatApi";
import { emitTeamChatMessage } from "../../features/realtime/emitGameplayRealtimeEvent";
import { createUuid } from "../../shared/utils/createUuid";
import { hintApi } from "../../features/hint/hintApi";
import {
  formatHintDisplayText,
  getCachedHint,
  getHintCacheKey,
  resolveHintCacheKeyFromMission,
  shouldRefetchHintOnOpen,
} from "../../features/hint/hintCache";
import { getRoomSocketLifecycleController, useRoomSocketLifecycle } from "../../features/realtime/useRoomSocketLifecycle";
import { getUserFacingErrorMessage } from "../../shared/utils/appError";
import type { TeamChatMessage, TurnEvaluationResult } from "../../shared/types/domain";
import { PracticeTutorialOverlay } from "../../features/onboarding/PracticeTutorialOverlay";
import {
  markPracticeTutorialDone,
  shouldStartPracticeTutorial,
} from "../../features/onboarding/practiceTutorial";
import backgroundRunImg from "../../assets/characters/background-run.png";
import catIdeaImg from "../../assets/characters/cat-idea.png";
import catNoImg from "../../assets/characters/cat-no.png";
import catImg from "../../assets/characters/cat.png";
import hamImg from "../../assets/characters/ham.png";
import lionImg from "../../assets/characters/lion.png";
import mouseImg from "../../assets/characters/mouse.png";
import rabbitRun1Img from "../../assets/characters/rabbit-run-1.png";
import rabbitRun2Img from "../../assets/characters/rabbit-run-2.png";
import rabbitRun3Img from "../../assets/characters/rabbit-run-3.png";
import rabbitRun4Img from "../../assets/characters/rabbit-run-4.png";
import rabbitImg from "../../assets/characters/rabbit.png";
import whiteImg from "../../assets/characters/white.png";
import {
  buildMissionFileTabs,
  buildMissionProgressSteps,
  buildParticipantRows,
  buildStrikeHeartDisplay,
  canEditGameplay,
  canMutateMissionFile,
  buildIssueDisplayItems,
  getTurnRemainingSeconds,
  findMissionFileTab,
  formatTurnTimerText,
  getCurrentTurnParticipantLabel,
  getParticipantAvatarIndex,
  getEvaluationDisplayCopy,
  getAnalysisPhaseDelayMs,
  getEvaluationFeedbackTab,
  getLanguageDisplayLabel,
  getMissionDisplayCopy,
  getMissionStepStatusLabel,
  isEditorContentReadOnly,
  resolveActiveFilePath,
  type EvaluationDisplayCopy,
  type MissionFileTab,
  type MissionProgressStep,
  type RoomParticipantRow,
  type StrikeHeartDisplay,
} from "./roomPageViewModel";

type AiMasterStep = "analysis" | "feedback" | "error";
type StartCountdownValue = 5 | 4 | 3 | 2 | 1 | "START";
const startCountdownSequence: StartCountdownValue[] = [5, 4, 3, 2, 1, "START"];
const startCountdownStepMs = 1000;
const submissionStallWarningDelayMs = 10000;
const emptyEditorFiles: Record<string, string> = {};

const participantAvatarImages = [
  whiteImg,
  catImg,
  rabbitImg,
  mouseImg,
  lionImg,
];

const aiMasterSteps: Array<{ id: AiMasterStep; label: string }> = [
  { id: "analysis", label: "코드 분석" },
  { id: "feedback", label: "코드 피드백" },
  { id: "error", label: "오류 피드백" },
];

const runnerFrames = [
  rabbitRun1Img,
  rabbitRun2Img,
  rabbitRun3Img,
  rabbitRun4Img,
];

function getParticipantAvatar(
  userId: string,
  participants: RoomParticipantRow[],
) {
  const index = getParticipantAvatarIndex(
    userId,
    participants.map((participant) => participant.userId),
    participantAvatarImages.length,
  );

  return participantAvatarImages[index];
}

function getParticipantAvatarAlt(nickname: string) {
  return `${nickname} 아바타`;
}

export function RoomPage() {
  const navigate = useNavigate();
  const { gameRoomId } = useParams();
  const store = useAppStoreApi();
  useRoomSocketLifecycle(gameRoomId);

  const authUserId = useAppStore((state) => state.auth.user?.userId ?? null);
  const gameState = useAppStore((state) => state.game.gameState);
  const missionState = useAppStore((state) => state.game.missionState);
  const showMissionGuideModal = useAppStore(
    (state) => state.game.showMissionGuideModal,
  );
  const lastTurnEvaluation = useAppStore(
    (state) => state.game.lastTurnEvaluation,
  );
  const turnSubmissionPending = useAppStore(
    (state) => state.game.turnSubmissionPending,
  );
  const editorFiles = useAppStore((state) => state.editor.files) ?? emptyEditorFiles;
  const activeFilePath = useAppStore((state) => state.editor.activeFilePath);
  const participants = useAppStore((state) => state.realtime.participants);
  const realtimeStatus = useAppStore((state) => state.realtime.connectionStatus);
  const socketId = useAppStore((state) => state.realtime.socketId);
  const hintsByStepId = useAppStore((state) => state.game.hintsByStepId);
  const closeCode = useAppStore((state) => state.realtime.closeCode);
  const closeReasonCode = useAppStore((state) => state.realtime.closeReasonCode);
  const currentRoomMode = useAppStore((state) => state.room.currentRoom?.mode);

  const closeBannerCopy = getRealtimeCloseBannerCopy({
    closeCode,
    closeReasonCode,
    connectionStatus: realtimeStatus,
  });
  const isRealtimeUnavailable = isRoomSessionUnavailable(realtimeStatus);

  const [aiMasterStep, setAiMasterStep] = useState<AiMasterStep>("analysis");
  const [isHintOpen, setIsHintOpen] = useState(false);
  const [hintPanelMessage, setHintPanelMessage] = useState<string | null>(null);
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [showSubmissionDelayWarning, setShowSubmissionDelayWarning] =
    useState(false);
  const [analysisStepIndex, setAnalysisStepIndex] = useState(0);
  const [isAnalysisRunning, setIsAnalysisRunning] = useState(false);
  const [isAnalysisRevealReady, setIsAnalysisRevealReady] = useState(false);
  const [startCountdown, setStartCountdown] =
    useState<StartCountdownValue>(5);
  const [isPracticeTutorialOpen, setIsPracticeTutorialOpen] = useState(false);
  const [hasResolvedPracticeTutorial, setHasResolvedPracticeTutorial] =
    useState(false);
  const [practiceStartPending, setPracticeStartPending] = useState(false);
  const [practiceStartError, setPracticeStartError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const startTimerRef = useRef<number | null>(null);
  const analysisCodeLengthRef = useRef(0);
  const itemUse = useAppStore((state) => state.game.itemUse);

  const fileTabs = useMemo(
    () => buildMissionFileTabs(missionState, editorFiles),
    [editorFiles, missionState],
  );
  const resolvedActiveFilePath = resolveActiveFilePath(activeFilePath, fileTabs);
  const selectedCode =
    resolvedActiveFilePath === null
      ? ""
      : (editorFiles[resolvedActiveFilePath] ?? "");
  const activeFileTab = findMissionFileTab(fileTabs, resolvedActiveFilePath);
  const selectedFileName = activeFileTab?.fileName ?? "파일 없음";

  const turnState = gameState?.turnState;
  const isPracticeMode =
    gameState?.mode === "PRACTICE" ||
    currentRoomMode === "PRACTICE";
  const isMyTurn = turnState?.currentPlayerId === authUserId;
  const canEditTurn = canEditGameplay(authUserId, gameState);
  const isTurnExpired = remainingSeconds <= 0;
  const isMissionGuideOpen = showMissionGuideModal && !isRealtimeUnavailable;
  const shouldShowStartCountdown =
    isMissionGuideOpen &&
    (!isPracticeMode ||
      (hasResolvedPracticeTutorial && !isPracticeTutorialOpen));
  const isGameplayIntroductionOpen =
    isMissionGuideOpen || isPracticeTutorialOpen;
  const canMutateActiveFile = canMutateMissionFile(canEditTurn, activeFileTab);
  const isEditorReadOnly = isEditorContentReadOnly({
    canEditTurn,
    tab: activeFileTab,
    isTurnExpired,
    isMissionGuideOpen: isGameplayIntroductionOpen,
    isRealtimeUnavailable,
  });
  const isTurnActionLocked = isEditorReadOnly || turnSubmissionPending;
  const isSubmitDisabled =
    turnSubmissionPending ||
    itemUse?.status === "pending" ||
    isGameplayIntroductionOpen ||
    isRealtimeUnavailable ||
    !canMutateActiveFile;

  const strikeDisplay = buildStrikeHeartDisplay(
    gameState?.strikeCount,
    gameState?.maxStrikeCount,
  );
  const languageLabel = getLanguageDisplayLabel(missionState?.language);
  const participantRows = buildParticipantRows(
    participants,
    turnState?.currentPlayerId,
    authUserId,
  );
  const { title: missionTitle, description: missionDescription } =
    getMissionDisplayCopy(missionState);
  const missionProgressSteps = buildMissionProgressSteps(missionState);
  const timerText = formatTurnTimerText(remainingSeconds);
  const canSyncItems = realtimeStatus === "connected" && itemUse?.status !== "pending" && itemUse?.status !== "syncing";
  const needsItemSync = !Array.isArray(gameState?.items) || itemUse?.status === "needs-sync";
  const unlockedItems = lastTurnEvaluation?.unlockedItems ?? [];

  const hasGameplayData = Boolean(gameState && missionState);
  const currentTurnLabel = getCurrentTurnParticipantLabel(participantRows);
  const evaluationDisplay = getEvaluationDisplayCopy({
    evaluation: lastTurnEvaluation,
    turnSubmissionPending,
  });

  const hintCacheKey = resolveHintCacheKeyFromMission({
    gameRoomMissionStepId: missionState?.gameRoomMissionStepId,
    missionTemplateStepId: missionState?.missionTemplateStepId,
  });
  const cachedHint = getCachedHint(hintsByStepId, hintCacheKey);

  const { trackLocalEditorChange, flushPendingCodeChanges } = useGameplayCodeSync({
    gameRoomId,
    userId: authUserId,
    socketId,
    connectionStatus: realtimeStatus,
    canEmit: canMutateActiveFile && !isTurnActionLocked,
    editorFiles,
  });

  useEffect(() => {
    if (
      turnState?.status !== "IN_PROGRESS" ||
      isGameplayIntroductionOpen
    ) {
      setRemainingSeconds(turnState?.timeLimitSeconds ?? 0);
      return;
    }

    const updateRemainingTime = () => setRemainingSeconds(
      getTurnRemainingSeconds(turnState, Date.now()),
    );
    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 250);
    return () => window.clearInterval(timerId);
  }, [
    isGameplayIntroductionOpen,
    turnState?.deadlineAt,
    turnState?.status,
    turnState?.timeLimitSeconds,
    turnState?.turnId,
  ]);

  useEffect(() => {
    if (!turnSubmissionPending || lastTurnEvaluation) {
      setShowSubmissionDelayWarning(false);
      return;
    }

    const warningTimerId = window.setTimeout(() => {
      setShowSubmissionDelayWarning(true);
    }, submissionStallWarningDelayMs);

    return () => window.clearTimeout(warningTimerId);
  }, [lastTurnEvaluation, turnSubmissionPending]);

  useEffect(() => {
    if (!isAnalysisRunning || isAnalysisRevealReady) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const moveToNextStep = (currentStepIndex: number) => {
      timerId = window.setTimeout(() => {
        if (cancelled) return;

        if (currentStepIndex >= aiMasterSteps.length - 1) {
          setIsAnalysisRevealReady(true);
          return;
        }

        const nextStepIndex = currentStepIndex + 1;
        setAnalysisStepIndex(nextStepIndex);
        moveToNextStep(nextStepIndex);
      }, getAnalysisPhaseDelayMs({
        phaseIndex: currentStepIndex,
        codeLength: analysisCodeLengthRef.current,
      }));
    };

    moveToNextStep(0);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isAnalysisRevealReady, isAnalysisRunning]);

  useEffect(() => {
    if (!isAnalysisRunning || !lastTurnEvaluation || !isAnalysisRevealReady) {
      return;
    }

    setAnalysisStepIndex(aiMasterSteps.length - 1);
    const resultTransitionTimerId = window.setTimeout(() => {
      setAiMasterStep(
        getEvaluationFeedbackTab(lastTurnEvaluation.judgeStatus),
      );
      setIsAnalysisRunning(false);
      setIsAnalysisRevealReady(false);
      setIsHintOpen(false);
    }, 220);

    return () => window.clearTimeout(resultTransitionTimerId);
  }, [isAnalysisRevealReady, isAnalysisRunning, lastTurnEvaluation]);

  useEffect(() => {
    return () => {
      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
      }
    };
  }, []);

  const completeGameIntroduction = useCallback(async () => {
    if (!isPracticeMode) {
      store.setState((state) => ({
        ...state,
        game: {
          ...state.game,
          showMissionGuideModal: false,
        },
      }));
      return;
    }

    if (!gameRoomId) {
      setPracticeStartError("개인연습 방 정보를 확인할 수 없어요.");
      return;
    }

    setPracticeStartPending(true);
    setPracticeStartError(null);

    try {
      const response = await gameRoomApi.startPracticeTurn(gameRoomId);
      const startedTurn = response?.turnState;

      if (!response?.success || !startedTurn) {
        throw new Error("개인연습을 시작하지 못했습니다.");
      }

      store.setState((state) => ({
        ...state,
        game: {
          ...state.game,
          gameState: state.game.gameState
            ? {
                ...state.game.gameState,
                turnState: startedTurn,
              }
            : state.game.gameState,
          showMissionGuideModal: false,
        },
      }));
    } catch (error) {
      setPracticeStartError(getUserFacingErrorMessage(error));
    } finally {
      setPracticeStartPending(false);
    }
  }, [gameRoomId, isPracticeMode, store]);

  useEffect(() => {
    if (!shouldShowStartCountdown) {
      return;
    }

    let sequenceIndex = 0;
    setStartCountdown(startCountdownSequence[sequenceIndex]);

    startTimerRef.current = window.setInterval(() => {
      sequenceIndex += 1;

      if (sequenceIndex < startCountdownSequence.length) {
        setStartCountdown(startCountdownSequence[sequenceIndex]);
        return;
      }

      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
        startTimerRef.current = null;
      }

      void completeGameIntroduction();
    }, startCountdownStepMs);

    return () => {
      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [completeGameIntroduction, shouldShowStartCountdown]);

  useEffect(() => {
    if (
      !authUserId ||
      !isPracticeMode ||
      !hasGameplayData ||
      !isMissionGuideOpen ||
      hasResolvedPracticeTutorial ||
      isRealtimeUnavailable
    ) {
      return;
    }

    try {
      if (shouldStartPracticeTutorial(window.localStorage, authUserId)) {
        setIsPracticeTutorialOpen(true);
      }
    } catch {
      // The tutorial remains available when browser persistence is blocked.
      setIsPracticeTutorialOpen(true);
    } finally {
      setHasResolvedPracticeTutorial(true);
    }
  }, [
    authUserId,
    hasResolvedPracticeTutorial,
    hasGameplayData,
    isMissionGuideOpen,
    isPracticeMode,
    isRealtimeUnavailable,
  ]);

  const handleClosePracticeTutorial = () => {
    setIsPracticeTutorialOpen(false);

    if (!authUserId) {
      return;
    }

    try {
      markPracticeTutorialDone(window.localStorage, authUserId);
    } catch {
      // Closing must still work when localStorage is unavailable.
    }
  };

  const handleSelectFile = (filePath: string) => {
    store.setState((state) => ({
      ...state,
      editor: {
        ...state.editor,
        activeFilePath: filePath,
      },
    }));
  };

  const handleEditorChange = (nextValue: string) => {
    if (!resolvedActiveFilePath || !canMutateActiveFile || isTurnActionLocked) {
      return;
    }

    const previousText = editorFiles[resolvedActiveFilePath] ?? "";

    store.setState((state) => ({
      ...state,
      editor: {
        ...state.editor,
        files: {
          ...state.editor.files,
          [resolvedActiveFilePath]: nextValue,
        },
      },
    }));

    trackLocalEditorChange(resolvedActiveFilePath, previousText, nextValue);
  };

  const handleToggleHint = async () => {
    if (aiMasterStep === "analysis") {
      return;
    }

    if (isHintOpen) {
      setIsHintOpen(false);
      return;
    }

    setIsHintOpen(true);

    if (!shouldRefetchHintOnOpen(hintsByStepId, hintCacheKey)) {
      setHintPanelMessage(formatHintDisplayText(cachedHint?.hintText));
      return;
    }

    const missionId = missionState?.missionId;
    if (!missionId) {
      setHintPanelMessage("미션 정보가 없어 힌트를 불러올 수 없습니다.");
      return;
    }

    setIsHintLoading(true);
    setHintPanelMessage(null);

    try {
      const hint = await hintApi.fetchCurrentStepHint(missionId);
      const cacheKey = getHintCacheKey(hint);

      store.setState((state) => ({
        ...state,
        game: {
          ...state.game,
          hintsByStepId: {
            ...state.game.hintsByStepId,
            [cacheKey]: hint,
          },
        },
      }));

      setHintPanelMessage(formatHintDisplayText(hint.hintText));
    } catch (error) {
      setHintPanelMessage(getUserFacingErrorMessage(error));
    } finally {
      setIsHintLoading(false);
    }
  };

  const handleResetEditor = () => {
    if (!resolvedActiveFilePath || !canMutateActiveFile || isTurnActionLocked) {
      return;
    }

    store.setState((state) => ({
      ...state,
      editor: applyEditorFileReset(
        state.editor,
        resolvedActiveFilePath,
        turnState?.turnId,
      ),
    }));
  };

  const handleSubmitTurn = () => {
    if (
      !gameRoomId ||
      !authUserId ||
      !turnState?.turnId ||
      isSubmitDisabled ||
      !canMutateActiveFile
    ) {
      return;
    }

    flushPendingCodeChanges();

    const codeSnapshot = buildTurnCodeSnapshot(editorFiles, missionState);
    const emitted = submitTurn({
      gameRoomId,
      userId: authUserId,
      turnId: turnState.turnId,
      codeSnapshot,
    });

    if (!emitted) {
      return;
    }

    setAiMasterStep("analysis");
    analysisCodeLengthRef.current = selectedCode.length;
    setAnalysisStepIndex(0);
    setIsAnalysisRunning(true);
    setIsAnalysisRevealReady(false);
    setIsHintOpen(false);

    store.setState((state) => ({
      ...state,
      game: {
        ...state.game,
        lastTurnEvaluation: null,
        turnSubmissionPending: true,
      },
      editor: {
        ...promoteSubmittedSnapshotToAuthoritative(
          state.editor,
          codeSnapshot,
          turnState.turnId,
        ),
        markers: [],
      },
    }));
  };

  const handleReleaseSubmissionLock = () => {
    setShowSubmissionDelayWarning(false);
    setIsAnalysisRunning(false);
    setIsAnalysisRevealReady(false);
    store.setState((state) => ({
      ...state,
      game: {
        ...state.game,
        turnSubmissionPending: false,
      },
    }));
  };

  return (
    <div className="room-page">
      <RoomHeader
        isPracticeMode={isPracticeMode}
        languageLabel={languageLabel}
        participantRows={participantRows}
        remainingSeconds={remainingSeconds}
        strikeDisplay={strikeDisplay}
        timerText={timerText}
        turnNumber={turnState?.turnNumber}
      />

      <section
        className="game-item-bar"
        data-practice-tutorial="items"
        aria-label="팀 공유 게임 아이템"
      >
        <div className="game-item-heading">
          <div>
            <strong>팀 공유 아이템</strong>
            <span>미션을 달성하면 이번 게임에서 사용할 수 있어요.</span>
          </div>
          {needsItemSync ? (
            <button className="game-item-sync" type="button" disabled={!canSyncItems}
              onClick={() => getRoomSocketLifecycleController()?.syncGameItems()}>
              상태 다시 확인
            </button>
          ) : null}
        </div>
        {unlockedItems.length > 0 ? (
          <div className="game-item-unlock-notice" role="status" aria-live="polite">
            🎉 {unlockedItems.map((item) => gameItemLabel(item.itemType)).join(", ")} 해금!
          </div>
        ) : null}
        <div className="game-item-list">
          {gameItemTypes.map((itemType) => {
            const item = findGameItem(gameState, itemType);
            const reason = itemDisabledReason(store.getState(), itemType);
            const isPending = itemUse?.status === "pending" && itemUse.pending?.itemType === itemType;
            const icon = itemType === "TIME_EXTENSION_30" ? "⏱️" : itemType === "STRIKE_SHIELD" ? "🛡️" : "🔄";
            return (
              <article className={`game-item-card ${item && item.unlocked !== false ? "is-unlocked" : "is-locked"}`} key={itemType}>
                <div className="game-item-card-title">
                  <span aria-hidden="true">{isPending ? "⏳" : icon}</span>
                  <strong>{gameItemLabel(itemType)}</strong>
                  <span className="game-item-count">{item && item.unlocked !== false ? `${item.remainingQuantity}개` : "잠김"}</span>
                </div>
                <p>{item && item.unlocked !== false ? gameItemDescription(itemType) : unlockRequirementLabel(itemType)}</p>
                {itemType === "TURN_PASS" && !item?.unlocked ? (
                  <span className="game-item-progress">연속 성공 {lastTurnEvaluation?.isStepCleared ? 1 : 0}/2</span>
                ) : null}
                {itemType === "STRIKE_SHIELD" && (item?.activeCount ?? 0) > 0 ? (
                  <span className="game-item-active">방어 활성화됨</span>
                ) : null}
                <button
                  className="game-item-button"
                  type="button"
                  disabled={!!reason || isGameplayIntroductionOpen}
                  aria-busy={isPending}
                  title={reason ?? gameItemDescription(itemType)}
                  onClick={() => getRoomSocketLifecycleController()?.useGameItem(itemType)}
                >
                  {item && item.unlocked !== false ? "사용하기" : "해금 필요"}
                </button>
              </article>
            );
          })}
        </div>
        <span className="game-item-message" role="status" aria-live="polite">{itemUse?.message}</span>
      </section>

      {isRealtimeUnavailable ? (
        <RealtimeBanner
          actionLabel="메인으로 돌아가기"
          description={closeBannerCopy.description}
          title={closeBannerCopy.title}
          onAction={() => navigate("/main")}
        />
      ) : null}

      {!hasGameplayData && !isRealtimeUnavailable ? (
        <RealtimeBanner
          description="실시간 게임 상태가 연결되면 화면이 표시됩니다."
          title="게임 정보를 불러오는 중"
        />
      ) : null}

      <main className="room-layout">
        <aside className="left-rail">
          <MissionPanel
            currentStepStatus={missionState?.currentStepStatus}
            languageLabel={languageLabel}
            missionDescription={missionDescription}
            missionTitle={missionTitle}
          />

          <FilePanel
            activeFilePath={resolvedActiveFilePath}
            fileTabs={fileTabs}
            onSelectFile={handleSelectFile}
          />

          <MemberPanel
            currentTurnLabel={currentTurnLabel}
            isPracticeMode={isPracticeMode}
            participantRows={participantRows}
          />
        </aside>

        <section className="main-column">
          <EditorPanel
            activeFileLanguage={activeFileTab?.language}
            activeFileReadonly={activeFileTab?.readonly}
            canEditTurn={canEditTurn}
            canMutateActiveFile={canMutateActiveFile}
            isEditorReadOnly={isEditorReadOnly}
            isSubmitDisabled={isSubmitDisabled}
            isTurnActionLocked={isTurnActionLocked}
            lastTurnEvaluation={lastTurnEvaluation}
            selectedCode={selectedCode}
            selectedFileName={selectedFileName}
            showSubmissionDelayWarning={showSubmissionDelayWarning}
            turnSubmissionPending={turnSubmissionPending}
            onChange={handleEditorChange}
            onReleaseSubmissionLock={handleReleaseSubmissionLock}
            onReset={handleResetEditor}
            onSubmit={handleSubmitTurn}
          />

          <ProgressPanel missionProgressSteps={missionProgressSteps} />
        </section>

        <aside className={`right-rail ${isPracticeMode ? "right-rail--practice" : ""}`}>
          <AiMasterPanel
            aiMasterStep={aiMasterStep}
            analysisStepIndex={analysisStepIndex}
            cachedHintText={cachedHint?.hintText}
            evaluation={lastTurnEvaluation}
            evaluationDisplay={evaluationDisplay}
            hintPanelMessage={hintPanelMessage}
            isHintLoading={isHintLoading}
            isHintOpen={isHintOpen}
            isAnalysisRunning={isAnalysisRunning}
            onSelectStep={(step) => {
              if (isAnalysisRunning) return;
              setAiMasterStep(step);
              setIsHintOpen(false);
            }}
            onToggleHint={() => {
              void handleToggleHint();
            }}
          />

          {!isPracticeMode ? <ChatPanel /> : null}
        </aside>
      </main>

      {shouldShowStartCountdown ? (
        <GameStartModal
          countdown={startCountdown}
          isStarting={practiceStartPending}
          missionTitle={missionTitle}
          participants={participantRows}
          startError={practiceStartError}
          onRetry={() => {
            void completeGameIntroduction();
          }}
        />
      ) : null}
      {isPracticeTutorialOpen ? (
        <PracticeTutorialOverlay onClose={handleClosePracticeTutorial} />
      ) : null}

    </div>
  );
}

function RoomHeader({
  isPracticeMode,
  languageLabel,
  participantRows,
  remainingSeconds,
  strikeDisplay,
  timerText,
  turnNumber,
}: {
  isPracticeMode: boolean;
  languageLabel: string | null;
  participantRows: RoomParticipantRow[];
  remainingSeconds: number;
  strikeDisplay: StrikeHeartDisplay;
  timerText: string;
  turnNumber: number | undefined;
}) {
  return (
    <header className="room-header">
      <div className="room-logo" aria-label="네코네코 홈">
        네코네코 <span>☘</span>
      </div>

      <div className="room-status">
        <div
          className="status-pill"
          aria-label={`남은 시간 ${remainingSeconds}초`}
        >
          <span>◷</span>
          <span>남은 시간</span>
          <strong>{timerText}</strong>
        </div>
        <div
          className="status-pill lives"
          aria-label={`팀 목숨 ${strikeDisplay.remaining}개 남음`}
        >
          <span>팀 목숨</span>
          {Array.from({ length: strikeDisplay.remaining }, (_, index) => (
            <span key={`heart-${index}`}>♥</span>
          ))}
          {Array.from({ length: strikeDisplay.lost }, (_, index) => (
            <span className="empty-heart" key={`empty-heart-${index}`}>
              ♡
            </span>
          ))}
        </div>
        {languageLabel ? (
          <div className="status-pill">{languageLabel}</div>
        ) : null}
        {turnNumber ? (
          <div className="status-pill" aria-label={`${turnNumber}턴`}>
            {turnNumber}턴
          </div>
        ) : null}
      </div>

      <div className="team-strip">
        {isPracticeMode ? (
          <strong>개인 연습</strong>
        ) : (
          <>
            <strong>팀원 {participantRows.length}명</strong>
            {participantRows.map((participant) => (
              <span className="avatar" key={participant.userId}>
                <img
                  src={getParticipantAvatar(participant.userId, participantRows)}
                  alt={getParticipantAvatarAlt(participant.nickname)}
                />
              </span>
            ))}
          </>
        )}
        <button className="settings-button" type="button" aria-label="설정">
          ⚙
        </button>
      </div>
    </header>
  );
}

function RealtimeBanner({
  actionLabel,
  description,
  title,
  onAction,
}: {
  actionLabel?: string;
  description: string;
  title: string;
  onAction?: () => void;
}) {
  return (
    <section className="socket-closed-banner" role="status">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

function MissionPanel({
  currentStepStatus,
  languageLabel,
  missionDescription,
  missionTitle,
}: {
  currentStepStatus: Parameters<typeof getMissionStepStatusLabel>[0];
  languageLabel: string | null;
  missionDescription: string;
  missionTitle: string;
}) {
  return (
    <section className="panel mission-panel" data-practice-tutorial="mission">
      <h2>⚑ 미션</h2>
      <strong className="mission-panel__title">{missionTitle}</strong>
      <p>{missionDescription}</p>
      <div className="mission-panel__meta">
        <span>{getMissionStepStatusLabel(currentStepStatus)}</span>
        {languageLabel ? <span>{languageLabel}</span> : null}
      </div>
      <img className="mission-mascot" src={hamImg} alt="미션 안내 캐릭터" />
    </section>
  );
}

function FilePanel({
  activeFilePath,
  fileTabs,
  onSelectFile,
}: {
  activeFilePath: string | null;
  fileTabs: MissionFileTab[];
  onSelectFile: (filePath: string) => void;
}) {
  return (
    <section className="panel file-panel">
      <h3>파일</h3>
      <div className="file-list">
        {fileTabs.length > 0 ? (
          fileTabs.map((file) => (
            <button
              className={file.filePath === activeFilePath ? "active" : ""}
              key={file.filePath}
              type="button"
              onClick={() => onSelectFile(file.filePath)}
            >
              ▣ {file.fileName}
            </button>
          ))
        ) : (
          <p>미션 파일이 아직 없습니다.</p>
        )}
      </div>
    </section>
  );
}

function MemberPanel({
  currentTurnLabel,
  isPracticeMode,
  participantRows,
}: {
  currentTurnLabel: string;
  isPracticeMode: boolean;
  participantRows: RoomParticipantRow[];
}) {
  return (
    <section className="panel member-panel">
      <div className="panel-header">
        <h3>팀원</h3>
        <span className="panel-header__meta">{currentTurnLabel}</span>
      </div>
      <div className="member-list">
        {isPracticeMode ? (
          <p>현재 턴: {currentTurnLabel}</p>
        ) : participantRows.length > 0 ? (
          participantRows.map((member) => (
            <ParticipantRow
              key={member.userId}
              member={member}
              participants={participantRows}
            />
          ))
        ) : (
          <p>참가자 정보를 불러오는 중입니다.</p>
        )}
      </div>
    </section>
  );
}

function EditorPanel({
  activeFileLanguage,
  activeFileReadonly,
  canEditTurn,
  canMutateActiveFile,
  isEditorReadOnly,
  isSubmitDisabled,
  isTurnActionLocked,
  lastTurnEvaluation,
  selectedCode,
  selectedFileName,
  showSubmissionDelayWarning,
  turnSubmissionPending,
  onChange,
  onReleaseSubmissionLock,
  onReset,
  onSubmit,
}: {
  activeFileLanguage: string | undefined;
  activeFileReadonly: boolean | undefined;
  canEditTurn: boolean;
  canMutateActiveFile: boolean;
  isEditorReadOnly: boolean;
  isSubmitDisabled: boolean;
  isTurnActionLocked: boolean;
  lastTurnEvaluation: unknown;
  selectedCode: string;
  selectedFileName: string;
  showSubmissionDelayWarning: boolean;
  turnSubmissionPending: boolean;
  onChange: (nextValue: string) => void;
  onReleaseSubmissionLock: () => void;
  onReset: () => void;
  onSubmit: () => void;
}) {
  const submitLabel = turnSubmissionPending
    ? lastTurnEvaluation
      ? "턴 전환 대기 중..."
      : "제출 처리 중..."
    : !canEditTurn
      ? "내 턴이 아닙니다"
      : activeFileReadonly
        ? "읽기 전용 파일"
        : "제출 하기";

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      isEditorReadOnly
    ) {
      return;
    }

    const textarea = event.currentTarget;
    const { value, selectionStart, selectionEnd } = textarea;
    const edit = applyEditorIndentKey(value, selectionStart, selectionEnd, {
      key: event.key,
      shiftKey: event.shiftKey,
      language: activeFileLanguage,
    });

    if (!edit) {
      return;
    }

    event.preventDefault();
    // Update the DOM and caret synchronously so fast typing never lands at a stale caret;
    // React then sees the same value on re-render and leaves the selection alone.
    textarea.value = edit.value;
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    onChange(edit.value);
  };

  return (
    <section className="editor-card panel" data-practice-tutorial="editor">
      <div className="editor-tab">{selectedFileName}</div>
      {showSubmissionDelayWarning ? (
        <div className="submit-warning" role="status">
          <div>
            <strong>제출 응답이 지연되고 있습니다.</strong>
            <span>실시간 이벤트가 늦으면 잠금을 해제한 뒤 다시 제출할 수 있습니다.</span>
          </div>
          <button type="button" onClick={onReleaseSubmissionLock}>
            잠금 해제
          </button>
        </div>
      ) : null}
      <textarea
        aria-label={`${selectedFileName} 코드 편집기`}
        className="code-editor"
        readOnly={isEditorReadOnly}
        spellCheck={false}
        value={selectedCode}
        onKeyDown={handleEditorKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="editor-actions">
        <button
          className={`submit-button ${canMutateActiveFile ? "active" : ""}`}
          type="button"
          disabled={isSubmitDisabled || !canMutateActiveFile}
          onClick={onSubmit}
        >
          ▶ {submitLabel}
        </button>
        <button
          className="reset-button"
          type="button"
          disabled={isTurnActionLocked}
          onClick={onReset}
        >
          ↺ 초기화
        </button>
      </div>
      <EditorStatusPanel
        activeFileReadonly={activeFileReadonly}
        canEditTurn={canEditTurn}
        canMutateActiveFile={canMutateActiveFile}
        isEditorReadOnly={isEditorReadOnly}
        isTurnActionLocked={isTurnActionLocked}
        selectedCode={selectedCode}
        selectedFileName={selectedFileName}
        turnSubmissionPending={turnSubmissionPending}
      />
    </section>
  );
}

function EditorStatusPanel({
  activeFileReadonly,
  canEditTurn,
  canMutateActiveFile,
  isEditorReadOnly,
  isTurnActionLocked,
  selectedCode,
  selectedFileName,
  turnSubmissionPending,
}: {
  activeFileReadonly: boolean | undefined;
  canEditTurn: boolean;
  canMutateActiveFile: boolean;
  isEditorReadOnly: boolean;
  isTurnActionLocked: boolean;
  selectedCode: string;
  selectedFileName: string;
  turnSubmissionPending: boolean;
}) {
  const lineCount = selectedCode.length === 0 ? 0 : selectedCode.split("\n").length;
  const characterCount = selectedCode.length;
  const editState = getEditorEditStateLabel({
    activeFileReadonly,
    canEditTurn,
    canMutateActiveFile,
    isEditorReadOnly,
    isTurnActionLocked,
    turnSubmissionPending,
  });
  const statusItems = [
    {
      label: "현재 파일",
      value: selectedFileName,
    },
    {
      label: "코드 라인",
      value: `${lineCount}줄`,
    },
    {
      label: "문자 수",
      value: `${characterCount}자`,
    },
    {
      label: "편집 상태",
      value: editState,
    },
  ];

  return (
    <dl className="editor-status-panel" aria-label="에디터 상태">
      {statusItems.map((item) => (
        <div className="editor-status-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function getEditorEditStateLabel({
  activeFileReadonly,
  canEditTurn,
  canMutateActiveFile,
  isEditorReadOnly,
  isTurnActionLocked,
  turnSubmissionPending,
}: {
  activeFileReadonly: boolean | undefined;
  canEditTurn: boolean;
  canMutateActiveFile: boolean;
  isEditorReadOnly: boolean;
  isTurnActionLocked: boolean;
  turnSubmissionPending: boolean;
}) {
  if (turnSubmissionPending) {
    return "제출 처리 중";
  }

  if (activeFileReadonly) {
    return "읽기 전용";
  }

  if (!canEditTurn) {
    return "턴 대기";
  }

  if (!canMutateActiveFile || isEditorReadOnly || isTurnActionLocked) {
    return "잠김";
  }

  return "편집 가능";
}

function ProgressPanel({
  missionProgressSteps,
}: {
  missionProgressSteps: MissionProgressStep[];
}) {
  const completedStepCount = missionProgressSteps.filter(
    (step) => step.status === "CLEARED",
  ).length;
  const activeStep = missionProgressSteps.find((step) => step.isActive);
  const waitingStepCount = missionProgressSteps.filter(
    (step) => step.status === "READY" || step.status === "LOCKED",
  ).length;
  const failedStepCount = missionProgressSteps.filter(
    (step) => step.status === "FAILED",
  ).length;

  return (
    <section className="panel progress-panel" data-practice-tutorial="progress">
      <h3>미션 진행도</h3>
      <MissionProgressSummary
        activeStepTitle={activeStep?.title ?? null}
        completedStepCount={completedStepCount}
        failedStepCount={failedStepCount}
        totalStepCount={missionProgressSteps.length}
        waitingStepCount={waitingStepCount}
      />
      <div className="progress-steps">
        {missionProgressSteps.length > 0 ? (
          missionProgressSteps.map((step) => (
            <article
              className={`progress-step ${
                step.status === "IN_PROGRESS"
                  ? "active"
                  : step.status === "CLEARED"
                    ? "done"
                    : "waiting"
              }`}
              key={step.key}
            >
              <span className="step-number">{step.stepOrder}</span>
              <span className="step-icon">{step.isActive ? "✣" : "•"}</span>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
              <em>{getMissionStepStatusLabel(step.status)}</em>
            </article>
          ))
        ) : (
          <p className="progress-empty">미션 진행 정보를 기다리는 중입니다.</p>
        )}
      </div>
    </section>
  );
}

function MissionProgressSummary({
  activeStepTitle,
  completedStepCount,
  failedStepCount,
  totalStepCount,
  waitingStepCount,
}: {
  activeStepTitle: string | null;
  completedStepCount: number;
  failedStepCount: number;
  totalStepCount: number;
  waitingStepCount: number;
}) {
  const summaryItems = [
    {
      label: "전체",
      value: `${totalStepCount}개`,
    },
    {
      label: "완료",
      value: `${completedStepCount}개`,
    },
    {
      label: "대기",
      value: `${waitingStepCount}개`,
    },
    {
      label: "실패",
      value: `${failedStepCount}개`,
    },
  ];

  return (
    <div className="progress-summary" aria-label="미션 진행 요약">
      <div className="progress-summary__current">
        <span>현재 단계</span>
        <strong>{activeStepTitle ?? "단계 정보를 기다리는 중"}</strong>
      </div>
      <dl className="progress-summary__stats">
        {summaryItems.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AiMasterPanel({
  aiMasterStep,
  analysisStepIndex,
  cachedHintText,
  evaluation,
  evaluationDisplay,
  hintPanelMessage,
  isHintLoading,
  isHintOpen,
  isAnalysisRunning,
  onSelectStep,
  onToggleHint,
}: {
  aiMasterStep: AiMasterStep;
  analysisStepIndex: number;
  cachedHintText: string | null | undefined;
  evaluation: TurnEvaluationResult | null;
  evaluationDisplay: EvaluationDisplayCopy;
  hintPanelMessage: string | null;
  isHintLoading: boolean;
  isHintOpen: boolean;
  isAnalysisRunning: boolean;
  onSelectStep: (step: AiMasterStep) => void;
  onToggleHint: () => void;
}) {
  return (
    <section className="panel ai-card" data-practice-tutorial="ai-master">
      <h3>
        <span>🤖</span> AI 마스터
      </h3>
      <div className="ai-tabs">
        {aiMasterSteps.map((step) => (
          <button
            className={aiMasterStep === step.id ? "active" : ""}
            key={step.id}
            type="button"
            disabled={isAnalysisRunning && step.id !== "analysis"}
            onClick={() => onSelectStep(step.id)}
          >
            {step.label}
          </button>
        ))}
      </div>

      <div className="ai-content">
        {aiMasterStep === "analysis" ? (
          <AnalysisView
            activeStepIndex={analysisStepIndex}
            evaluationDisplay={evaluationDisplay}
            isRunning={isAnalysisRunning}
          />
        ) : null}

        {aiMasterStep === "feedback" ? (
          <FeedbackView
            cachedHintText={cachedHintText}
            evaluation={evaluation}
            evaluationDisplay={evaluationDisplay}
            hintPanelMessage={hintPanelMessage}
            isHintLoading={isHintLoading}
            isHintOpen={isHintOpen}
          />
        ) : null}

        {aiMasterStep === "error" ? (
          <ErrorFeedbackView
            evaluation={evaluation}
            evaluationDisplay={evaluationDisplay}
          />
        ) : null}
      </div>

      {aiMasterStep !== "analysis" ? (
        <div className="ai-footer">
          <button type="button" disabled={isHintLoading} onClick={onToggleHint}>
            💡 {isHintOpen ? "힌트 닫기" : "힌트 보기"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AnalysisView({
  activeStepIndex,
  evaluationDisplay,
  isRunning,
}: {
  activeStepIndex: number;
  evaluationDisplay: EvaluationDisplayCopy;
  isRunning: boolean;
}) {
  const analysisStepNotices = [
    "코드 구조와 문법을 살펴보고 있어요.",
    "조건문과 계산 흐름을 검증하고 있어요.",
    "준비된 테스트 입력으로 코드를 실행하고 있어요.",
    "분석 결과를 정리하고 있어요.",
  ];

  return (
    <div className="analysis-view">
      <strong>
        AI 마스터가 <span>코드를 분석</span>{isRunning ? "하고 있어요" : "할 준비가 되었어요"}
      </strong>
      <small>
        {isRunning
          ? analysisStepNotices[activeStepIndex]
          : "턴 제출 후 단계별 분석 과정이 여기에 표시됩니다."}
      </small>
      <div className="analysis-steps" aria-label="코드 분석 진행도">
        {["코드 구조 분석", "로직 검증", "테스트 실행", "결과 생성"].map((label, index) => {
          const isCompleted = isRunning && index < activeStepIndex;
          const isActive = isRunning && index === activeStepIndex;

          return (
            <span
              className={`${isCompleted ? "completed" : ""} ${isActive ? "active" : ""}`.trim()}
              key={label}
            >
              <i aria-hidden="true" />
              {index + 1} {label}
            </span>
          );
        })}
      </div>
      <div
        className="run-track"
        style={{ backgroundImage: `url(${backgroundRunImg})` }}
      >
        <div className={`runner ${isRunning ? "running" : "paused"}`}>
          {runnerFrames.map((frame, index) => (
            <img
              alt=""
              key={frame}
              src={frame}
              style={{ animationDelay: `${index * 0.14}s` }}
            />
          ))}
        </div>
      </div>
      <div className="analysis-notice">
        {isRunning
          ? analysisStepNotices[activeStepIndex]
          : evaluationDisplay.analysisNotice}
      </div>
    </div>
  );
}

function FeedbackView({
  cachedHintText,
  evaluation,
  evaluationDisplay,
  hintPanelMessage,
  isHintLoading,
  isHintOpen,
}: {
  cachedHintText: string | null | undefined;
  evaluation: TurnEvaluationResult | null;
  evaluationDisplay: EvaluationDisplayCopy;
  hintPanelMessage: string | null;
  isHintLoading: boolean;
  isHintOpen: boolean;
}) {
  return (
    <div className="feedback-view">
      <img className="floating-mascot" src={catIdeaImg} alt="힌트 캐릭터" />
      <div className="feedback-card">
        <strong>코드 피드백</strong>
        <em className="feedback-card__status">
          {evaluationDisplay.statusLabel}
        </em>
        <p>{evaluationDisplay.feedbackMessage}</p>
        {evaluation?.stepJudgingSummary ? (
          <p className="feedback-card__test-summary">
            테스트 {evaluation.stepJudgingSummary.passedCount}/
            {evaluation.stepJudgingSummary.totalCases} 통과
          </p>
        ) : null}
      </div>
      <HintPanel open={isHintOpen}>
        {isHintLoading
          ? "힌트를 불러오는 중입니다..."
          : hintPanelMessage ?? formatHintDisplayText(cachedHintText)}
      </HintPanel>
    </div>
  );
}

function ErrorFeedbackView({
  evaluation,
  evaluationDisplay,
}: {
  evaluation: TurnEvaluationResult | null;
  evaluationDisplay: EvaluationDisplayCopy;
}) {
  const issueItems = buildIssueDisplayItems(evaluation);

  return (
    <div className="feedback-view">
      <img className="floating-mascot" src={catNoImg} alt="오류 안내 캐릭터" />
      <div className="feedback-card error">
        <strong>ⓘ 오류 피드백</strong>
        <em className="feedback-card__status error">
          {evaluationDisplay.statusLabel}
        </em>
        <p>{evaluationDisplay.errorMessage}</p>
        <IssueFeedbackDetails issueItems={issueItems} />
      </div>
    </div>
  );
}

function IssueFeedbackDetails({
  issueItems,
}: {
  issueItems: ReturnType<typeof buildIssueDisplayItems>;
}) {
  if (issueItems.length === 0) {
    return null;
  }

  return (
    <ol className="ai-issue-list">
      {issueItems.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <b>{item.title}</b>
          <p>{item.explanation}</p>
          {item.tip ? (
            <div className="ai-issue-list__tip">
              <span aria-hidden="true">💡</span>
              <span><strong>이렇게 고쳐보세요</strong>{item.tip}</span>
            </div>
          ) : null}
          {item.rows.length > 0 ? (
            <dl>
              {item.rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {item.technicalDetails ? (
            <details>
              <summary>개발자용 오류 원문 보기</summary>
              <pre>{item.technicalDetails}</pre>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ChatPanel() {
  const { gameRoomId } = useParams();
  const store = useAppStoreApi();
  const currentUserId = useAppStore((state) => state.auth.user?.userId ?? null);
  const messages = useAppStore((state) => state.teamChat.messages);
  const isLoading = useAppStore((state) => state.teamChat.isLoading);
  const isSending = useAppStore((state) => state.teamChat.isSending);
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastMessageId = messages[messages.length - 1]?.messageId ?? null;

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || !lastMessageId) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [lastMessageId]);

  useEffect(() => {
    if (!gameRoomId) return;
    let cancelled = false;
    store.setState((state) => ({
      ...state,
      teamChat: { ...state.teamChat, messages: [], isLoading: true },
    }));
    void listTeamChatMessages(gameRoomId)
      .then((loadedMessages) => {
        if (cancelled) return;
        store.setState((state) => ({
          ...state,
          teamChat: {
            ...state.teamChat,
            messages: [
              ...(loadedMessages ?? []),
              ...state.teamChat.messages.filter(
                (message) =>
                  !(loadedMessages ?? []).some(
                    (loadedMessage) => loadedMessage.messageId === message.messageId,
                  ),
              ),
            ],
            isLoading: false,
          },
        }));
      })
      .catch(() => {
        if (cancelled) return;
        store.setState((state) => ({
          ...state,
          teamChat: { ...state.teamChat, isLoading: false },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoomId, store]);

  const sendMessage = () => {
    const content = draft.trim();
    if (!gameRoomId || !content || isSending || content.length > 500) return;
    const clientMessageId = createUuid();
    store.setState((state) => ({
      ...state,
      teamChat: { ...state.teamChat, isSending: true },
    }));
    if (emitTeamChatMessage({ gameRoomId, content, clientMessageId })) {
      setDraft("");
    } else {
      store.setState((state) => ({
        ...state,
        teamChat: { ...state.teamChat, isSending: false },
      }));
    }
    window.setTimeout(() => {
      store.setState((state) => ({
        ...state,
        teamChat: { ...state.teamChat, isSending: false },
      }));
    }, 500);
  };

  return (
    <section className="panel chat-card">
      <h3>팀 채팅 ⧉</h3>
      <p>팀원들과 실시간으로 대화할 수 있습니다.</p>
      <div className="messages" aria-label="팀 채팅 메시지" ref={messagesRef}>
        {isLoading ? <p>메시지를 불러오는 중입니다.</p> : null}
        {!isLoading && messages.length === 0 ? <p>첫 메시지를 남겨보세요.</p> : null}
        {messages.map((message: TeamChatMessage) => (
          <article
            className={`message ${message.senderUserId === currentUserId ? "mine" : ""}`}
            key={message.messageId}
          >
            <div>
              <span>{message.senderUserId === currentUserId ? "나" : message.senderNickname}</span>
              <p>{message.content}</p>
            </div>
          </article>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <input
          aria-label="팀 채팅 입력"
          maxLength={500}
          placeholder="메시지를 입력하세요"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" aria-label="메시지 전송" disabled={!draft.trim() || isSending}>
          ↑
        </button>
      </form>
    </section>
  );
}

function ParticipantRow({
  member,
  participants,
}: {
  member: RoomParticipantRow;
  participants: RoomParticipantRow[];
}) {
  const displayName = member.isCurrentUser ? "나" : member.nickname;
  const roleSuffix = member.roleLabel ? ` (${member.roleLabel})` : "";

  return (
    <div className={`member-row ${member.isCurrentTurn ? "current" : ""}`}>
      <span className="avatar">
        <img
          src={getParticipantAvatar(member.userId, participants)}
          alt={getParticipantAvatarAlt(member.nickname)}
        />
      </span>
      <strong>
        {displayName}
        {roleSuffix}
      </strong>
      {member.isCurrentTurn ? <em>현재 턴</em> : null}
    </div>
  );
}

function HintPanel({
  children,
  open,
}: {
  children: React.ReactNode;
  open: boolean;
}) {
  return (
    <div className={`hint-panel ${open ? "open" : ""}`}>
      <strong>💡 힌트 보기</strong>
      <p>{children}</p>
    </div>
  );
}

function GameStartModal({
  countdown,
  isStarting,
  missionTitle,
  participants,
  startError,
  onRetry,
}: {
  countdown: StartCountdownValue;
  isStarting: boolean;
  missionTitle: string;
  participants: RoomParticipantRow[];
  startError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="modal-overlay start-overlay" role="dialog" aria-modal="true">
      <div className="start-modal">
        <h2>게임 시작 준비!</h2>
        <p>잠시후 게임이 시작됩니다</p>
        <section className="start-card mission">
          <h3>⚑ 미션</h3>
          <span>{missionTitle}</span>
          <img src={hamImg} alt="미션 안내 캐릭터" />
        </section>
        <section className="start-card">
          <h3>♧ 턴 순서</h3>
          <div className="turn-order">
            {participants.map((member, index) => (
              <div key={member.userId}>
                <span className="avatar">
                  <img
                    src={getParticipantAvatar(member.userId, participants)}
                    alt={getParticipantAvatarAlt(member.nickname)}
                  />
                </span>
                <b>{index + 1}</b>
                <small>
                  {member.isCurrentUser ? "나" : member.nickname}
                  {member.roleLabel ? ` (${member.roleLabel})` : ""}
                </small>
              </div>
            ))}
          </div>
        </section>
        <div className="countdown-stage">
          <span className="sparkle one" />
          <span className="sparkle two" />
          <span className="sparkle three" />
          <div className={`countdown-circle ${countdown === "START" ? "start" : ""}`}>
            {countdown !== "START" ? (
              <svg viewBox="0 0 128 128" aria-hidden="true">
                <circle className="gauge-track" cx="64" cy="64" r="54" />
                <circle key={countdown} className="gauge-progress" cx="64" cy="64" r="54" />
              </svg>
            ) : null}
            <span>{countdown === "START" ? "START!" : countdown}</span>
          </div>
        </div>
        <p className="countdown-help">카운트다운이 끝나면 게임이 자동으로 시작됩니다!</p>
        {isStarting ? (
          <p className="countdown-start-status" role="status">
            개인연습 타이머를 시작하고 있어요...
          </p>
        ) : null}
        {startError ? (
          <div className="countdown-start-error" role="alert">
            <span>{startError}</span>
            <button type="button" onClick={onRetry}>
              다시 시작
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
