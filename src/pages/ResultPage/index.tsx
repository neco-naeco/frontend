import { useQueryClient } from "@tanstack/react-query";
import { clearRoomContextAfterTerminatedSession } from "../../features/realtime/applySocketClosePolicy";
import { getRoomSocketLifecycleController } from "../../features/realtime/useRoomSocketLifecycle";
import { useNavigate, useParams } from "react-router-dom";
import teamHappyImg from "../../assets/characters/team-happy.png";
import teamSadImg from "../../assets/characters/team-sad.png";
import { useAppStore, useAppStoreApi } from "../../app/providers/ClientStateProvider";
import type { MissionDifficulty } from "../../shared/types/domain";
import { PageShell } from "../../shared/components/PageShell";
import {
  getMissionResultPresentation,
  loadMissionResultSession,
} from "../../features/game-result/missionResultModel";
import { RoomPage } from "../RoomPage";
import "./ResultPage.css";

export function ResultPage() {
  const navigate = useNavigate();
  const { gameRoomId } = useParams();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();

  async function returnToMain() {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ["main-page-current-room"] }),
      queryClient.cancelQueries({ queryKey: ["main-page-invitations"] }),
    ]);
    getRoomSocketLifecycleController()?.leave(gameRoomId);
    clearRoomContextAfterTerminatedSession(store);
    queryClient.removeQueries({ queryKey: ["main-page-current-room"] });
    queryClient.removeQueries({ queryKey: ["main-page-invitations"] });
    navigate("/main");
  }

  const realtimeMissionResult = useAppStore((state) => state.game.missionResult);
  const currentRoom = useAppStore((state) => state.room.currentRoom);
  const gameState = useAppStore((state) => state.game.gameState);
  const missionState = useAppStore((state) => state.game.missionState);
  const missionResult =
    realtimeMissionResult ?? loadMissionResultSession(gameRoomId);

  if (!missionResult) {
    return (
      <PageShell
        title="미션 결과"
        description="종료된 게임의 결과를 불러올 수 없습니다. 메인으로 돌아가 새 게임을 시작해 주세요."
      >
        <div className="result-page__fallback-actions">
          <button type="button" onClick={() => void returnToMain()}>
            메인으로
          </button>
        </div>
      </PageShell>
    );
  }

  const resultPresentation = getMissionResultPresentation(missionResult);
  const { executionOutput, executionLabel, isSuccess } = resultPresentation;
  const descriptionId = "mission-result-description";
  const titleId = "mission-result-title";
  const isPractice = currentRoom?.mode === "PRACTICE" || gameState?.mode === "PRACTICE";
  const practiceDifficulty = missionState?.difficulty ?? gameState?.difficulty ?? currentRoom?.difficulty;
  const practiceTemplateId = missionState?.missionTemplateId;
  const canRestartPractice =
    isPractice &&
    Boolean(practiceTemplateId) &&
    Boolean(practiceDifficulty);

  function goToPracticeSelection() {
    getRoomSocketLifecycleController()?.leave(gameRoomId);
    clearRoomContextAfterTerminatedSession(store);
    queryClient.removeQueries({ queryKey: ["main-page-current-room"] });
    queryClient.removeQueries({ queryKey: ["main-page-invitations"] });
    navigate("/main", { state: { practice: { action: "select" } } });
  }

  function restartPractice() {
    if (!practiceTemplateId || !practiceDifficulty) return;
    getRoomSocketLifecycleController()?.leave(gameRoomId);
    clearRoomContextAfterTerminatedSession(store);
    queryClient.removeQueries({ queryKey: ["main-page-current-room"] });
    queryClient.removeQueries({ queryKey: ["main-page-invitations"] });
    navigate("/main", {
      state: {
        practice: {
          action: "restart",
          selection: {
            difficulty: practiceDifficulty as MissionDifficulty,
            missionTemplateId: practiceTemplateId,
          },
        },
      },
    });
  }

  return (
    <main className="result-page">
      <div
        className="result-page__game-background"
        aria-hidden="true"
        ref={(element) => {
          element?.setAttribute("inert", "");
        }}
      >
        <RoomPage />
      </div>

      <div className="result-page__overlay">
        <section
          className={`result-dialog ${isSuccess ? "result-dialog--success" : "result-dialog--failure"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <p className="result-dialog__eyebrow">
            {isSuccess ? "축하드립니다!" : "아쉽지만..."}
          </p>
          <h1 id={titleId}>
            {isSuccess ? "성공하셨습니다!" : "실패하셨습니다!"}
          </h1>

          <img
            className="result-dialog__characters"
            src={isSuccess ? teamHappyImg : teamSadImg}
            alt={isSuccess ? "성공을 축하하는 팀 캐릭터" : "아쉬워하는 팀 캐릭터"}
          />

          <p id={descriptionId} className="result-dialog__message">
            {isSuccess
              ? "모든 코드를 잘 작성했어요!🥳"
              : "팀 목숨을 모두 사용했어요."}
          </p>

          {executionOutput ? (
            <section className="result-dialog__execution" aria-label={executionLabel}>
              <h2>✍🏻 {executionLabel}</h2>
              <output>{executionOutput}</output>
            </section>
          ) : null}

          {isPractice ? (
            <div className="result-page__practice-actions">
              <button type="button" autoFocus disabled={!canRestartPractice} onClick={restartPractice}>
                같은 미션 다시 연습
              </button>
              <button type="button" onClick={goToPracticeSelection}>
                다른 미션 선택
              </button>
            </div>
          ) : (
            <button type="button" autoFocus onClick={() => void returnToMain()}>
              게임 종료
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
