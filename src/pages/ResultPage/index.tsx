import { useNavigate, useParams } from "react-router-dom";
import teamHappyImg from "../../assets/characters/team-happy.png";
import teamSadImg from "../../assets/characters/team-sad.png";
import { useAppStore } from "../../app/providers/ClientStateProvider";
import { useRoomSocketLifecycle } from "../../features/realtime/useRoomSocketLifecycle";
import { PageShell } from "../../shared/components/PageShell";
import "./ResultPage.css";

function formatExecutionResult(actualOutputs: unknown[][]) {
  const output = actualOutputs[actualOutputs.length - 1];

  return output
    ? `[${output.map((value) => JSON.stringify(value)).join(", ")}]`
    : null;
}

export function ResultPage() {
  const navigate = useNavigate();
  const { gameRoomId } = useParams();
  useRoomSocketLifecycle(gameRoomId);

  const missionResult = useAppStore((state) => state.game.missionResult);

  if (!missionResult) {
    return (
      <PageShell
        title="미션 결과"
        description="실시간 미션 결과가 아직 도착하지 않았습니다. 게임 화면에서 플레이를 이어가거나 메인으로 돌아가세요."
      >
        <div className="result-page__fallback-actions">
          {gameRoomId ? (
            <button
              type="button"
              onClick={() => navigate(`/rooms/${gameRoomId}/play`)}
            >
              게임 화면으로
            </button>
          ) : null}
          <button type="button" onClick={() => navigate("/main")}>
            메인으로
          </button>
        </div>
      </PageShell>
    );
  }

  const isSuccess = missionResult.isMissionCleared;
  const executionResult = formatExecutionResult(missionResult.actualOutputs);
  const descriptionId = "mission-result-description";
  const titleId = "mission-result-title";

  return (
    <main className="result-page">
      <div className="result-page__game-preview" aria-hidden="true">
        <div className="result-page__preview-header" />
        <div className="result-page__preview-sidebar" />
        <div className="result-page__preview-editor" />
        <div className="result-page__preview-chat" />
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
