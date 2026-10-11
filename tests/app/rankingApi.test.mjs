import assert from "node:assert/strict";
import test from "node:test";
import { createRankingApi } from "../../src/features/ranking/rankingApi.ts";

test("ranking api requests team and individual rankings with an explicit limit", async () => {
  const requestedPaths = [];
  const api = createRankingApi({
    async get(path) {
      requestedPaths.push(path);
      return [];
    },
  });

  assert.deepEqual(await api.listTeams(20), []);
  assert.deepEqual(await api.listIndividuals(30), []);
  assert.deepEqual(requestedPaths, [
    "/rankings/teams?limit=20",
    "/rankings/individual?limit=30",
  ]);
});

test("ranking api normalizes empty response bodies to empty lists", async () => {
  const api = createRankingApi({
    async get() {
      return null;
    },
  });

  assert.deepEqual(await api.listTeams(), []);
  assert.deepEqual(await api.listIndividuals(), []);
});
