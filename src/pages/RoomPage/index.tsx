import Editor, { type BeforeMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./RoomPage.css";
import { useAppStore } from "../../app/providers/ClientStateProvider";
import { isRoomSessionUnavailable } from "../../features/realtime/roomSocketLifecycle";
import { useRoomSocketLifecycle } from "../../features/realtime/useRoomSocketLifecycle";
import { isPresentationMockScenario } from "../MainPage/mockMode";
import {
  buildCalculatorTypingFrame,
  buildCompletedCalculatorCode,
  calculatorMissionSteps,
  calculatorMissionStepSnippets,
  isCalculatorStepComplete,
  resolveMissionTurn,
} from "./missionProgress";
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
import teamHappyImg from "../../assets/characters/team-happy.png";
import teamSadImg from "../../assets/characters/team-sad.png";
import whiteImg from "../../assets/characters/white.png";

type TeamMember = {
  id: string;
  name: string;
  role?: string;
  avatar: string;
  avatarAlt: string;
  color: string;
  status: "current" | "done" | "waiting";
};

type MissionFile = {
  id: string;
  name: string;
  content: string;
};

type AiMasterStep = "analysis" | "hint" | "error";
type ResultModalState = "success" | "failure" | null;
type StartCountdownValue = 5 | 4 | 3 | 2 | 1 | "START";

const missionFiles: MissionFile[] = [
  {
    id: "main.py",
    name: "main.py",
    content: "",
  },
];

const teamMembers: TeamMember[] = [
  {
    id: "me",
    name: "나",
    role: "현재",
    avatar: whiteImg,
    avatarAlt: "흰 캐릭터",
    color: "#f8b8b8",
    status: "current",
  },
  {
    id: "hyun",
    name: "현",
    avatar: catImg,
    avatarAlt: "파란 리본 캐릭터",
    color: "#b9d9f3",
    status: "done",
  },
  {
    id: "junghwa",
    name: "정화",
    avatar: rabbitImg,
    avatarAlt: "토끼 캐릭터",
    color: "#f7de9d",
    status: "waiting",
  },
  {
    id: "sungmin",
    name: "성민",
    avatar: mouseImg,
    avatarAlt: "파란 귀 캐릭터",
    color: "#c7e8f7",
    status: "waiting",
  },
  {
    id: "suhyun",
    name: "수현",
    avatar: lionImg,
    avatarAlt: "노란 캐릭터",
    color: "#f8dfb5",
    status: "waiting",
  },
];

const teamMessages = [
  {
    id: 1,
    name: "성민",
    time: "14:32",
    avatar: mouseImg,
    avatarAlt: "파란 귀 캐릭터",
    color: "#c7e8f7",
    text: "짝수만 따로 모으면 좋아질 것 같지!",
    mine: false,
  },
  {
    id: 2,
    name: "나",
    time: "14:33",
    avatar: whiteImg,
    avatarAlt: "흰 캐릭터",
    color: "#f8b8b8",
    text: "응 좋아. 바로 추가할게",
    mine: true,
  },
  {
    id: 3,
    name: "현",
    time: "14:34",
    avatar: catImg,
    avatarAlt: "파란 리본 캐릭터",
    color: "#b9d9f3",
    text: "그럼 다음은 출력하는 함수 만들면 되겠다",
    mine: false,
  },
  {
    id: 4,
    name: "정화",
    time: "14:34",
    avatar: rabbitImg,
    avatarAlt: "토끼 캐릭터",
    color: "#f7de9d",
    text: "좋게 가보자고!",
    mine: false,
  },
];

const aiMasterSteps: Array<{ id: AiMasterStep; label: string }> = [
  { id: "analysis", label: "코드 분석" },
  { id: "hint", label: "힌트 보기" },
  { id: "error", label: "오류 피드백" },
];

const aiAnalysisSteps = [
  "코드 구조 분석",
  "로직 검증",
  "테스트 실행",
  "결과 생성",
];

const runnerFrames = [
  rabbitRun1Img,
  rabbitRun2Img,
  rabbitRun3Img,
  rabbitRun4Img,
];

const currentUserId = "me";
const currentTurnFileId = "main.py";
const turnTimeLimitSeconds = 30;
const aiAnalysisDurationMs = 10_000;
const aiAnalysisProgressIntervalMs =
  aiAnalysisDurationMs / aiAnalysisSteps.length;
const autoTypingIntervalMs = 110;
const autoTypingStartDelayMs = 1_600;
const autoSubmitDelayMs = 500;
const turnStartCodeByFile = Object.fromEntries(
  missionFiles.map((file) => [file.id, file.content]),
);
const configureMonaco: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("neconaeco-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#071107",
      "editor.lineHighlightBackground": "#f4f8ed",
      "editorLineNumber.foreground": "#a2aa9b",
      "editorLineNumber.activeForeground": "#668342",
      "editorCursor.foreground": "#31552b",
      "editor.selectionBackground": "#dcebd2",
      "editorIndentGuide.background1": "#edf1e9",
    },
  });
};

export function RoomPage() {
  const navigate = useNavigate();
  const { gameRoomId } = useParams();
  const mockScenario = new URLSearchParams(window.location.search).get("mock");
  const isPresentationMock = isPresentationMockScenario(mockScenario);
  useRoomSocketLifecycle(gameRoomId, !isPresentationMock);
  const realtimeStatus = useAppStore((state) => state.realtime.connectionStatus);
  const terminatedReason = useAppStore((state) => state.realtime.terminatedReason);
  const isRealtimeUnavailable =
    !isPresentationMock && isRoomSessionUnavailable(realtimeStatus);
  const [selectedFileId, setSelectedFileId] = useState(missionFiles[0].id);
  const [fileContents, setFileContents] =
    useState<Record<string, string>>(turnStartCodeByFile);
  const fileContentsRef = useRef(fileContents);
  const [aiMasterStep, setAiMasterStep] = useState<AiMasterStep>("analysis");
  const [isStartModalOpen, setIsStartModalOpen] = useState(true);
  const [startCountdown, setStartCountdown] =
    useState<StartCountdownValue>(5);
  const [resultModal, setResultModal] = useState<ResultModalState>(null);
  const [isAiJudging, setIsAiJudging] = useState(false);
  const [hasErrorFeedback, setHasErrorFeedback] = useState(false);
  const [isScriptedRelayActive, setIsScriptedRelayActive] = useState(false);
  const [isAutoTyping, setIsAutoTyping] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(-1);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingLives, setRemainingLives] = useState(3);
  const [turnNotice, setTurnNotice] = useState(
    "1단계 코드를 작성한 뒤 제출해주세요.",
  );
  const [turnDeadlineAt, setTurnDeadlineAt] = useState(
    () => Date.now() + turnTimeLimitSeconds * 1000,
  );
  const [remainingSeconds, setRemainingSeconds] =
    useState(turnTimeLimitSeconds);
  const judgingTimerRef = useRef<number | null>(null);
  const analysisProgressTimerRef = useRef<number | null>(null);
  const autoTypingTimerRef = useRef<number | null>(null);
  const autoTypingStartTimerRef = useRef<number | null>(null);
  const autoSubmitTimerRef = useRef<number | null>(null);
  const autoRelayRunKeyRef = useRef<string | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const timeoutHandledRef = useRef(false);
  const currentTurnUser = teamMembers[currentTurnIndex];
  const isMyTurn = currentTurnUser.id === currentUserId;
  const isTurnExpired = remainingSeconds <= 0;
  const isTurnActionLocked =
    !isMyTurn ||
    isScriptedRelayActive ||
    isAutoTyping ||
    isAiJudging ||
    isTurnExpired ||
    isStartModalOpen ||
    resultModal !== null ||
    isRealtimeUnavailable;
  const isSuccessResult = resultModal === "success";
  const canFollowCurrentTurn = missionFiles.length > 1;
  const selectedFile =
    missionFiles.find((file) => file.id === selectedFileId) ?? missionFiles[0];
  const selectedCode = fileContents[selectedFile.id] ?? selectedFile.content;
  const timerText = `${String(Math.floor(remainingSeconds / 60)).padStart(
    2,
    "0",
  )} : ${String(remainingSeconds % 60).padStart(2, "0")}`;
  const startNextTurn = useCallback((nextTurnIndex: number) => {
    timeoutHandledRef.current = false;
    setCurrentTurnIndex(nextTurnIndex);
    setRemainingSeconds(turnTimeLimitSeconds);
    setTurnDeadlineAt(Date.now() + turnTimeLimitSeconds * 1000);
  }, []);

  const failCurrentTurn = useCallback(
    (reason: "submit" | "timeout") => {
      const outcome = resolveMissionTurn({
        completed: false,
        currentStepIndex,
        currentTurnIndex,
        participantCount: teamMembers.length,
        remainingLives,
      });
      setRemainingLives(outcome.remainingLives);
      if (isPresentationMock) {
        const completedCode = buildCompletedCalculatorCode(currentStepIndex);

        fileContentsRef.current = {
          ...fileContentsRef.current,
          [currentTurnFileId]: completedCode,
        };
        setFileContents(fileContentsRef.current);
        setIsScriptedRelayActive(true);
      }

      if (outcome.result === "failure") {
        setTurnNotice("팀 목숨을 모두 사용했어요.");
        setResultModal("failure");
        return;
      }

      setTurnNotice(
        reason === "timeout"
          ? `제한시간이 끝났어요. ${teamMembers[(currentTurnIndex + 1) % teamMembers.length].name}님이 ${currentStepIndex + 1}단계를 이어서 작성합니다.`
          : `아직 ${currentStepIndex + 1}단계 구현이 부족해요. ${teamMembers[(currentTurnIndex + 1) % teamMembers.length].name}님이 이어서 작성합니다.`,
      );
      startNextTurn(outcome.nextTurnIndex);
    },
    [
      currentStepIndex,
      currentTurnIndex,
      isPresentationMock,
      remainingLives,
      startNextTurn,
    ],
  );

  const completeCurrentStep = useCallback(() => {
    const outcome = resolveMissionTurn({
      completed: true,
      currentStepIndex,
      currentTurnIndex,
      participantCount: teamMembers.length,
      remainingLives,
    });

    if (outcome.result === "success") {
      setTurnNotice("계산기 미션의 모든 단계를 완성했어요.");
      setResultModal("success");
      return;
    }

    setCurrentStepIndex(outcome.nextStepIndex);
    setAiMasterStep("analysis");
    setHasErrorFeedback(false);
    setTurnNotice(
      `${currentStepIndex + 1}단계를 완료했어요. ${teamMembers[outcome.nextTurnIndex].name}님이 ${outcome.nextStepIndex + 1}단계를 작성합니다.`,
    );
    startNextTurn(outcome.nextTurnIndex);
  }, [currentStepIndex, currentTurnIndex, remainingLives, startNextTurn]);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    return () => {
      if (judgingTimerRef.current !== null) {
        window.clearTimeout(judgingTimerRef.current);
      }

      if (analysisProgressTimerRef.current !== null) {
        window.clearInterval(analysisProgressTimerRef.current);
      }

      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
      }

      if (autoTypingTimerRef.current !== null) {
        window.clearInterval(autoTypingTimerRef.current);
      }

      if (autoTypingStartTimerRef.current !== null) {
        window.clearTimeout(autoTypingStartTimerRef.current);
      }

      if (autoSubmitTimerRef.current !== null) {
        window.clearTimeout(autoSubmitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isStartModalOpen) {
      return;
    }

    const sequence: StartCountdownValue[] = [5, 4, 3, 2, 1, "START"];
    let sequenceIndex = 0;
    setStartCountdown(sequence[sequenceIndex]);

    startTimerRef.current = window.setInterval(() => {
      sequenceIndex += 1;

      if (sequenceIndex < sequence.length) {
        setStartCountdown(sequence[sequenceIndex]);
        return;
      }

      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
        startTimerRef.current = null;
      }

      setIsStartModalOpen(false);
      setRemainingSeconds(turnTimeLimitSeconds);
      setTurnDeadlineAt(Date.now() + turnTimeLimitSeconds * 1000);
    }, 1000);

    return () => {
      if (startTimerRef.current !== null) {
        window.clearInterval(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [isStartModalOpen]);

  useEffect(() => {
    if (isStartModalOpen) {
      setRemainingSeconds(turnTimeLimitSeconds);
      return;
    }

    const updateRemainingTime = () => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((turnDeadlineAt - Date.now()) / 1000)),
      );
    };

    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 250);

    return () => window.clearInterval(timerId);
  }, [isStartModalOpen, turnDeadlineAt]);

  useEffect(() => {
    if (
      isStartModalOpen ||
      isAiJudging ||
      resultModal !== null ||
      remainingSeconds > 0 ||
      timeoutHandledRef.current
    ) {
      return;
    }

    timeoutHandledRef.current = true;
    failCurrentTurn("timeout");
  }, [
    failCurrentTurn,
    isAiJudging,
    isStartModalOpen,
    remainingSeconds,
    resultModal,
  ]);

  const submitCodeForAnalysis = useCallback((codeToJudge: string) => {
    setAiMasterStep("analysis");
    setHasErrorFeedback(false);
    setIsAiJudging(true);
    setAnalysisProgress(0);

    if (judgingTimerRef.current !== null) {
      window.clearTimeout(judgingTimerRef.current);
    }

    if (analysisProgressTimerRef.current !== null) {
      window.clearInterval(analysisProgressTimerRef.current);
    }

    analysisProgressTimerRef.current = window.setInterval(() => {
      setAnalysisProgress((currentProgress) =>
        Math.min(currentProgress + 1, aiAnalysisSteps.length - 1),
      );
    }, aiAnalysisProgressIntervalMs);

    judgingTimerRef.current = window.setTimeout(() => {
      if (analysisProgressTimerRef.current !== null) {
        window.clearInterval(analysisProgressTimerRef.current);
        analysisProgressTimerRef.current = null;
      }

      setIsAiJudging(false);
      const isCurrentStepComplete = isCalculatorStepComplete(
        currentStepIndex,
        codeToJudge,
      );

      if (isCurrentStepComplete) {
        completeCurrentStep();
      } else {
        setHasErrorFeedback(true);
        setAiMasterStep("error");
        failCurrentTurn("submit");
      }

      judgingTimerRef.current = null;
    }, aiAnalysisDurationMs);
  }, [completeCurrentStep, currentStepIndex, failCurrentTurn]);

  useEffect(() => {
    if (
      !isPresentationMock ||
      !isScriptedRelayActive ||
      isStartModalOpen ||
      isAiJudging ||
      resultModal !== null
    ) {
      return;
    }

    const runKey = `${currentTurnIndex}:${currentStepIndex}`;

    if (autoRelayRunKeyRef.current === runKey) {
      return;
    }

    autoRelayRunKeyRef.current = runKey;
    const currentWriter = teamMembers[currentTurnIndex];
    const currentSnippet = calculatorMissionStepSnippets[currentStepIndex];
    const existingCode = fileContentsRef.current[currentTurnFileId] ?? "";
    const separator = existingCode.trim().length > 0 ? "\n\n" : "";
    const appendedSnippet = `${separator}${currentSnippet}`;
    const completedCode = `${existingCode}${appendedSnippet}`;
    let typedCharacterCount = 0;

    setTurnNotice(
      `${currentWriter.name}님이 힌트를 확인하고 ${currentStepIndex + 1}단계를 작성합니다.`,
    );

    autoTypingStartTimerRef.current = window.setTimeout(() => {
      setAiMasterStep("hint");
      setIsAutoTyping(true);
      autoTypingTimerRef.current = window.setInterval(() => {
        typedCharacterCount += 1;
        setFileContents((currentContents) => ({
          ...currentContents,
          [currentTurnFileId]: buildCalculatorTypingFrame(
            existingCode,
            currentStepIndex,
            typedCharacterCount,
          ),
        }));

        if (typedCharacterCount < appendedSnippet.length) {
          return;
        }

        if (autoTypingTimerRef.current !== null) {
          window.clearInterval(autoTypingTimerRef.current);
          autoTypingTimerRef.current = null;
        }

        setIsAutoTyping(false);
        setTurnNotice(`${currentWriter.name}님이 코드를 제출했습니다.`);
        autoSubmitTimerRef.current = window.setTimeout(() => {
          submitCodeForAnalysis(completedCode);
          autoSubmitTimerRef.current = null;
        }, autoSubmitDelayMs);
      }, autoTypingIntervalMs);
      autoTypingStartTimerRef.current = null;
    }, autoTypingStartDelayMs);

    return () => {
      if (autoTypingStartTimerRef.current !== null) {
        window.clearTimeout(autoTypingStartTimerRef.current);
        autoTypingStartTimerRef.current = null;
      }

      if (autoTypingTimerRef.current !== null) {
        window.clearInterval(autoTypingTimerRef.current);
        autoTypingTimerRef.current = null;
      }
    };
  }, [
    currentStepIndex,
    currentTurnIndex,
    isAiJudging,
    isPresentationMock,
    isScriptedRelayActive,
    isStartModalOpen,
    resultModal,
    submitCodeForAnalysis,
  ]);

  const handleSubmitTurn = () => {
    if (isTurnActionLocked) {
      return;
    }

    submitCodeForAnalysis(selectedCode);
  };

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-logo" aria-label="네코네코 홈">
          네코네코 <span>☘</span>
        </div>

        <div className="room-status">
          <div className="status-pill" aria-label={`남은 시간 ${remainingSeconds}초`}>
            <span>◷</span>
            <span>남은 시간</span>
            <strong>{timerText}</strong>
          </div>
          <div className="status-pill lives" aria-label={`팀 목숨 ${remainingLives}개 남음`}>
            <span>팀 목숨</span>
            {[0, 1, 2].map((heartIndex) => (
              <span
                className={heartIndex < remainingLives ? "" : "empty-heart"}
                key={heartIndex}
              >
                {heartIndex < remainingLives ? "♥" : "♡"}
              </span>
            ))}
          </div>
          <div className="status-pill">🐍 Python</div>
        </div>

        <div className="team-strip">
          <strong>Team Chikawa</strong>
          {teamMembers.map((member) => (
            <span className="avatar" key={member.id}>
              <img src={member.avatar} alt={member.avatarAlt} />
            </span>
          ))}
          <button className="settings-button" type="button" aria-label="설정">
            ⚙
          </button>
        </div>
      </header>

      {isRealtimeUnavailable ? (
        <section className="socket-closed-banner" role="status">
          <div>
            <strong>
              {realtimeStatus === "error"
                ? "실시간 연결에 실패했어요."
                : "실시간 연결이 종료됐어요."}
            </strong>
            <span>
              {terminatedReason ??
                (realtimeStatus === "error"
                  ? "연결 상태를 확인한 뒤 다시 입장해주세요."
                  : "게임 세션이 닫혔습니다.")}
            </span>
          </div>
          <button type="button" onClick={() => navigate("/main")}>
            메인으로 돌아가기
          </button>
        </section>
      ) : null}

      <main className="room-layout">
        <aside className="left-rail">
          <section className="panel mission-panel">
            <h2>⚑ 미션</h2>
            <p>PYTHON으로 표준 입력을 읽어 사칙연산 계산기를 단계별로 완성합니다.</p>
            <img className="mission-mascot" src={hamImg} alt="미션 안내 캐릭터" />
          </section>

          <section className="panel file-panel">
            <h3>파일</h3>
            <div className="file-list">
              {missionFiles.map((file) => (
                <button
                  className={file.id === selectedFileId ? "active" : ""}
                  key={file.id}
                  type="button"
                  onClick={() => setSelectedFileId(file.id)}
                >
                  ▣ {file.name}
                </button>
              ))}
            </div>
          </section>

          <section className="panel member-panel">
            <div className="panel-header">
              <h3>팀원</h3>
              <button
                type="button"
                disabled={!canFollowCurrentTurn}
                onClick={() => setSelectedFileId(currentTurnFileId)}
              >
                따라가기
              </button>
            </div>
            <div className="member-list">
              {teamMembers.map((member, memberIndex) => (
                <div
                  className={`member-row ${memberIndex === currentTurnIndex ? "current" : ""}`}
                  key={member.id}
                >
                  <span className="avatar">
                    <img src={member.avatar} alt={member.avatarAlt} />
                  </span>
                  <strong>
                    {member.name}
                    {memberIndex === currentTurnIndex ? " (현재)" : ""}
                  </strong>
                  {memberIndex === currentTurnIndex ? <em>현재 턴</em> : null}
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="main-column">
          <section className="editor-card panel">
            <div className="editor-tab">{selectedFile.name}</div>
            <div className="code-editor-shell">
              <Editor
                beforeMount={configureMonaco}
                defaultLanguage="python"
                language="python"
                options={{
                  automaticLayout: true,
                  fontFamily: '"Fira Code", Consolas, monospace',
                  fontSize: 18,
                  lineHeight: 32,
                  lineNumbers: "on",
                  lineNumbersMinChars: 3,
                  minimap: { enabled: false },
                  padding: { top: 78, bottom: 24 },
                  readOnly: isTurnActionLocked,
                  renderLineHighlight: "all",
                  roundedSelection: false,
                  scrollBeyondLastLine: false,
                  scrollbar: {
                    horizontalScrollbarSize: 10,
                    verticalScrollbarSize: 10,
                  },
                  tabSize: 4,
                }}
                path={selectedFile.id}
                theme="neconaeco-light"
                value={selectedCode}
                onChange={(value) => {
                  if (isTurnActionLocked) {
                    return;
                  }

                  setFileContents((currentContents) => ({
                    ...currentContents,
                    [selectedFile.id]: value ?? "",
                  }));
                }}
              />
            </div>
            <div className="editor-actions">
              <button
                className={`submit-button ${isMyTurn && !isAiJudging ? "active" : ""}`}
                type="button"
                disabled={isTurnActionLocked}
                onClick={handleSubmitTurn}
              >
                ▶ {isAiJudging ? "분석 중" : "제출 하기"}
              </button>
              <button
                className="reset-button"
                type="button"
                disabled={isTurnActionLocked}
                onClick={() => setFileContents(turnStartCodeByFile)}
              >
                ↺ 초기화
              </button>
            </div>
          </section>

          <section className="panel progress-panel">
            <div className="progress-header">
              <h3>미션 진행도</h3>
              <span role="status">{turnNotice}</span>
            </div>
            <div className="progress-steps">
              {calculatorMissionSteps.map((step, stepIndex) => {
                const stepState =
                  stepIndex < currentStepIndex
                    ? "done"
                    : stepIndex === currentStepIndex
                      ? "active"
                      : "waiting";

                return (
                <article className={`progress-step ${stepState}`} key={step.id}>
                  <span className="step-number">{step.id}</span>
                  <div className="step-content">
                    <span className="step-icon">{stepState === "done" ? "✓" : "✣"}</span>
                    <strong>{step.title}</strong>
                  </div>
                  <em>
                    {stepState === "done"
                      ? "완료"
                      : stepState === "active"
                        ? "진행 중"
                        : "대기 중"}
                  </em>
                </article>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <section className="panel ai-card">
            <h3>
              <span>🤖</span> AI 마스터
            </h3>
            <div className="ai-tabs">
              {aiMasterSteps.map((step) => {
                const isDisabled = step.id === "error" && !hasErrorFeedback;

                return (
                <button
                  className={aiMasterStep === step.id ? "active" : ""}
                  disabled={isDisabled}
                  key={step.id}
                  type="button"
                  onClick={() => {
                    setAiMasterStep(step.id);
                  }}
                >
                  {step.label}
                </button>
                );
              })}
            </div>

            <div className="ai-content">
              {aiMasterStep === "analysis" ? (
                <div className="analysis-view">
                  <strong>
                    {isAiJudging ? (
                      <>
                        AI 마스터가 <span>코드를 분석</span>하고 있어요!
                      </>
                    ) : (
                      <>
                        코드를 작성하고 <span>제출</span>해 주세요!
                      </>
                    )}
                  </strong>
                  <small>
                    {isAiJudging
                      ? "잠시만 기다려주세요. 약 5~10초 소요"
                      : "제출하면 AI 마스터가 단계별로 코드를 확인해드려요."}
                  </small>
                  <div className="analysis-steps">
                    {aiAnalysisSteps.map((step, stepIndex) => (
                      <span
                        className={
                          isAiJudging && stepIndex <= analysisProgress
                            ? "active"
                            : ""
                        }
                        key={step}
                      >
                        {stepIndex + 1} {step}
                      </span>
                    ))}
                  </div>
                  <div
                    className="run-track"
                    style={{ backgroundImage: `url(${backgroundRunImg})` }}
                  >
                    <div className={`runner ${isAiJudging ? "running" : "idle"}`}>
                      {isAiJudging ? (
                        runnerFrames.map((frame, index) => (
                          <img
                            alt=""
                            key={frame}
                            src={frame}
                            style={{ animationDelay: `${index * 0.14}s` }}
                          />
                        ))
                      ) : (
                        <img alt="분석 대기 중인 토끼 캐릭터" src={rabbitRun1Img} />
                      )}
                    </div>
                  </div>
                  <div className="analysis-notice">
                    {isAiJudging
                      ? "제출한 코드를 분석하고 있어요..."
                      : turnNotice}
                  </div>
                </div>
              ) : null}

              {aiMasterStep === "hint" ? (
                <div className="feedback-view">
                  <img className="floating-mascot" src={catIdeaImg} alt="힌트 캐릭터" />
                  <div className="feedback-card">
                    <strong>💡 힌트 보기</strong>
                    <p>
                      현재 진행 중인 단계는{" "}
                      {calculatorMissionSteps[currentStepIndex].title}입니다.
                    </p>
                    <hr />
                    <p>{calculatorMissionSteps[currentStepIndex].description}</p>
                  </div>
                </div>
              ) : null}

              {aiMasterStep === "error" ? (
                <div className="feedback-view">
                  <img className="floating-mascot" src={catNoImg} alt="오류 안내 캐릭터" />
                  <div className="feedback-card error">
                    <strong>ⓘ 코드에 문제가 있어요!</strong>
                    <p>
                      {calculatorMissionSteps[currentStepIndex].title} 단계 구현이 아직
                      완료되지 않았어요. 다음 작성자가 기존 코드를 이어서 수정합니다.
                    </p>
                    <hr />
                    <b>💡 수정 방향</b>
                    <p>{calculatorMissionSteps[currentStepIndex].description}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel chat-card">
            <h3>팀 채팅 ⧉</h3>
            <div className="messages">
              {teamMessages.map((message) => (
                <div className={`message ${message.mine ? "mine" : ""}`} key={message.id}>
                  {!message.mine ? (
                    <span className="avatar">
                      <img src={message.avatar} alt={message.avatarAlt} />
                    </span>
                  ) : null}
                  <div>
                    <span>
                      <strong>{message.name}</strong> {message.time}
                    </span>
                    <p>{message.text}</p>
                  </div>
                  {message.mine ? (
                    <span className="avatar">
                      <img src={message.avatar} alt={message.avatarAlt} />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <label className="chat-input">
              <input placeholder="메시지를 입력하세요..." />
              <button type="button" aria-label="메시지 전송">
                ➤
              </button>
            </label>
          </section>
        </aside>
      </main>

      {resultModal ? (
        <ResultModal
          result={resultModal}
          success={isSuccessResult}
          onClose={() =>
            navigate(isPresentationMock ? "/main?mock=presentation-owner" : "/main")
          }
        />
      ) : null}

      {isStartModalOpen ? (
        <GameStartModal
          countdown={startCountdown}
          missionTitle="PYTHON으로 표준 입력을 읽어 사칙연산 계산기를 단계별로 완성합니다."
          order={teamMembers}
        />
      ) : null}
    </div>
  );
}

function ResultModal({
  onClose,
  result,
  success,
}: {
  onClose: () => void;
  result: Exclude<ResultModalState, null>;
  success: boolean;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className={`result-modal ${result}`}>
        <strong>{success ? "축하드립니다!" : "아쉽지만..."}</strong>
        <h2>{success ? "성공하셨습니다!" : "실패하셨습니다!"}</h2>
        <img
          src={success ? teamHappyImg : teamSadImg}
          alt={success ? "성공한 팀 캐릭터" : "실패한 팀 캐릭터"}
        />
        <p>{success ? "모든 코드를 잘 작성했어요!" : "팀 목숨을 모두 사용했어요."}</p>
        <button type="button" onClick={onClose}>
          게임 종료
        </button>
      </div>
    </div>
  );
}

function GameStartModal({
  countdown,
  missionTitle,
  order,
}: {
  countdown: StartCountdownValue;
  missionTitle: string;
  order: TeamMember[];
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
            {order.map((member, index) => (
              <div key={member.id}>
                <span className="avatar">
                  <img src={member.avatar} alt={member.avatarAlt} />
                </span>
                <b>{index + 1}</b>
                <small>
                  {member.name}
                  {member.role ? ` (${member.role})` : ""}
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
      </div>
    </div>
  );
}
