import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  rankingApi,
  type IndividualRankingEntry,
  type RankingDifficulty,
  type TeamRankingEntry,
} from "../../features/ranking/rankingApi";
import "./RankingPage.css";

type RankingCategory = "team" | "individual";

export function RankingPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<RankingCategory>("team");
  const teamRankingQuery = useQuery<TeamRankingEntry[]>({
    queryKey: ["rankings", "team"],
    queryFn: () => rankingApi.listTeams(),
    staleTime: 30_000,
    enabled: category === "team",
  });
  const individualRankingQuery = useQuery<IndividualRankingEntry[]>({
    queryKey: ["rankings", "individual"],
    queryFn: () => rankingApi.listIndividuals(),
    staleTime: 30_000,
    enabled: category === "individual",
  });
  const rankingQuery = category === "team" ? teamRankingQuery : individualRankingQuery;

  return (
    <main className="ranking-page">
      <header className="ranking-page__topbar">
        <button
          type="button"
          className="ranking-page__back"
          onClick={() => navigate("/main")}
        >
          <span aria-hidden="true">←</span>
          메인으로
        </button>
        <span className="signup-screen__logo">
          네코내코<span className="signup-screen__logo-paw">♣</span>
        </span>
      </header>

      <section className="ranking-page__content" aria-labelledby="ranking-title">
        <div className="ranking-page__heading">
          <p>네코내코 명예의 전당</p>
          <h1 id="ranking-title">랭킹</h1>
          <span>팀 성적과 개인 기여도를 한눈에 확인해보세요.</span>
        </div>

        <div className="ranking-page__tabs" role="tablist" aria-label="랭킹 종류">
          <button
            id="team-ranking-tab"
            type="button"
            role="tab"
            aria-selected={category === "team"}
            aria-controls="ranking-panel"
            className={category === "team" ? "ranking-page__tab--active" : undefined}
            onClick={() => setCategory("team")}
          >
            팀 랭킹
          </button>
          <button
            id="individual-ranking-tab"
            type="button"
            role="tab"
            aria-selected={category === "individual"}
            aria-controls="ranking-panel"
            className={category === "individual" ? "ranking-page__tab--active" : undefined}
            onClick={() => setCategory("individual")}
          >
            개인 기여도
          </button>
        </div>

        <section
          id="ranking-panel"
          className="ranking-page__panel"
          role="tabpanel"
          aria-labelledby={
            category === "team" ? "team-ranking-tab" : "individual-ranking-tab"
          }
        >
          {rankingQuery.isPending ? <RankingLoading /> : null}
          {rankingQuery.isError ? (
            <RankingError onRetry={() => void rankingQuery.refetch()} />
          ) : null}
          {rankingQuery.isSuccess && rankingQuery.data.length === 0 ? (
            <RankingEmpty category={category} />
          ) : null}
          {rankingQuery.isSuccess && rankingQuery.data.length > 0 ? (
            category === "team" ? (
              <TeamRankingList entries={rankingQuery.data as TeamRankingEntry[]} />
            ) : (
              <IndividualRankingList
                entries={rankingQuery.data as IndividualRankingEntry[]}
              />
            )
          ) : null}
        </section>
      </section>
    </main>
  );
}

function RankingLoading() {
  return (
    <div className="ranking-page__state" role="status" aria-live="polite">
      <span className="ranking-page__spinner" aria-hidden="true" />
      <h2>랭킹을 불러오고 있어요.</h2>
      <p>완료된 팀전 기록을 집계하는 중입니다.</p>
    </div>
  );
}

function RankingError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ranking-page__state" role="alert">
      <span className="ranking-page__trophy" aria-hidden="true">!</span>
      <h2>랭킹을 불러오지 못했어요.</h2>
      <p>잠시 후 다시 시도해 주세요.</p>
      <button type="button" className="ranking-page__retry" onClick={onRetry}>
        다시 불러오기
      </button>
    </div>
  );
}

function RankingEmpty({ category }: { category: RankingCategory }) {
  return (
    <div className="ranking-page__state">
      <span className="ranking-page__trophy" aria-hidden="true">🏆</span>
      <h2>아직 {category === "team" ? "팀" : "개인"} 랭킹 기록이 없어요.</h2>
      <p>멀티플레이 미션을 완료하면 이곳에 순위가 기록됩니다.</p>
    </div>
  );
}

function TeamRankingList({ entries }: { entries: TeamRankingEntry[] }) {
  return (
    <ol className="ranking-list" aria-label="팀 랭킹">
      {entries.map((entry) => (
        <li className="ranking-card" key={entry.gameRoomId}>
          <RankBadge rank={entry.rank} />
          <div className="ranking-card__identity">
            <strong>{entry.participants.map((participant) => participant.nickname).join(" · ")}</strong>
            <span>
              {difficultyLabel[entry.difficulty]} · {entry.missionCleared ? "미션 성공" : "미션 실패"}
            </span>
          </div>
          <div className="ranking-card__metrics">
            <span>남은 목숨 {entry.remainingStrikes}</span>
            <strong>{entry.score.toLocaleString("ko-KR")}점</strong>
          </div>
        </li>
      ))}
    </ol>
  );
}

function IndividualRankingList({ entries }: { entries: IndividualRankingEntry[] }) {
  return (
    <ol className="ranking-list" aria-label="개인 기여도 랭킹">
      {entries.map((entry) => (
        <li className="ranking-card" key={entry.userId}>
          <RankBadge rank={entry.rank} />
          <div className="ranking-card__identity">
            <strong>{entry.nickname}</strong>
            <span>
              단계 성공 {entry.clearedSteps} · 첫 시도 성공 {entry.firstAttemptClears}
            </span>
          </div>
          <div className="ranking-card__metrics">
            <span>
              실패 {entry.failedAttempts}
              {entry.averageClearSeconds === null
                ? ""
                : ` · 평균 ${entry.averageClearSeconds}초`}
            </span>
            <strong>{entry.score.toLocaleString("ko-KR")}점</strong>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={`ranking-card__rank ranking-card__rank--${Math.min(rank, 4)}`}>
      <span className="ranking-card__rank-label">순위</span>
      <strong>{rank}</strong>
    </span>
  );
}

const difficultyLabel: Record<RankingDifficulty, string> = {
  EASY: "쉬움",
  NORMAL: "보통",
  HARD: "어려움",
};
