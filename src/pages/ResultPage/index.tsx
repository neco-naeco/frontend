import { useNavigate, useParams } from "react-router-dom";
import teamHappyImg from "../../assets/characters/team-happy.png";
import teamSadImg from "../../assets/characters/team-sad.png";
import { useAppStore } from "../../app/providers/ClientStateProvider";
import { PageShell } from "../../shared/components/PageShell";
import {
  formatMissionExecutionResult,
  loadMissionResultSession,
} from "../../features/game-result/missionResultModel";
import { RoomPage } from "../RoomPage";
import "./ResultPage.css";

export function ResultPage() {
  const navigate = useNavigate();
  const { gameRoomId } = useParams();

  const realtimeMissionResult = useAppStore((state) => state.game.missionResult);
  const missionResult =
    realtimeMissionResult ?? loadMissionResultSession(gameRoomId);

  if (!missionResult) {
    return (
      <PageShell
        title="미션 결과"
        description="종료된 게임의 결과를 불러올 수 없습니다. 메인으로 돌아가 새 게임을 시작해 주세요."
      >
        <div className="result-page__fallback-actions">
          <button type="button" onClick={() => navigate("/main")}>
            메인으로
          </button>
        </div>
      </PageShell>
    );
  }

  const isSuccess = missionResult.isMissionCleared;
  const executionResult = formatMissionExecutionResult(missionResult);
  const descriptionId = "mission-result-description";
  const titleId = "mission-result-title";

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

          {isSuccess && executionResult ? (
            <section className="result-dialog__execution" aria-label="실행 결과">
              <h2>✍🏻 실행 결과</h2>
              <output>{executionResult}</output>
            </section>
          ) : null}

          <button type="button" autoFocus onClick={() => navigate("/main")}>
            게임 종료
          </button>
        </section>
      </div>
    </main>
  );
}
