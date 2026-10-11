import { apiClient } from "../../shared/api/apiClient";

export type RankingDifficulty = "EASY" | "NORMAL" | "HARD";

export type TeamRankingEntry = {
  rank: number;
  gameRoomId: string;
  score: number;
  difficulty: RankingDifficulty;
  missionCleared: boolean;
  remainingStrikes: number;
  participants: Array<{
    userId: string;
    nickname: string;
  }>;
};

export type IndividualRankingEntry = {
  rank: number;
  userId: string;
  nickname: string;
  score: number;
  clearedSteps: number;
  failedAttempts: number;
  firstAttemptClears: number;
  averageClearSeconds: number | null;
  scoreBreakdown: {
    clear: number;
    firstAttempt: number;
    time: number;
    failure: number;
  };
};

type RankingApiClient = Pick<typeof apiClient, "get">;

export function createRankingApi(client: RankingApiClient = apiClient) {
  return {
    async listTeams(limit = 50) {
      return (
        (await client.get<TeamRankingEntry[]>(`/rankings/teams?limit=${limit}`)) ?? []
      );
    },
    async listIndividuals(limit = 50) {
      return (
        (await client.get<IndividualRankingEntry[]>(
          `/rankings/individual?limit=${limit}`,
        )) ?? []
      );
    },
  };
}

export const rankingApi = createRankingApi();
