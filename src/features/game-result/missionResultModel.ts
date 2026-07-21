import type { MissionResult } from "../../shared/types/domain";

type MissionResultStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

const MISSION_RESULT_STORAGE_PREFIX = "neconaeco.missionResult";

function getMissionResultStorageKey(gameRoomId: string) {
  return `${MISSION_RESULT_STORAGE_PREFIX}.${gameRoomId}`;
}

function getBrowserSessionStorage(): MissionResultStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isMissionResult(value: unknown): value is MissionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MissionResult>;
  return (
    typeof candidate.missionId === "string" &&
    typeof candidate.isMissionCleared === "boolean" &&
    typeof candidate.judgeStatus === "string"
  );
}

export function formatMissionExecutionResult(result: MissionResult) {
  const legacyOutputs = result.actualOutputs;

  if (Array.isArray(legacyOutputs) && legacyOutputs.length > 0) {
    const output = legacyOutputs[legacyOutputs.length - 1];

    if (Array.isArray(output)) {
      return `[${output.map((value) => JSON.stringify(value)).join(", ")}]`;
    }

    if (typeof output === "string") {
      return output;
    }

    return JSON.stringify(output);
  }

  const stdout = result.executionSummary?.stdout?.trim();
  return stdout || null;
}

export function saveMissionResultSession(
  gameRoomId: string,
  result: MissionResult,
  storage: MissionResultStorage | null = getBrowserSessionStorage(),
) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(getMissionResultStorageKey(gameRoomId), JSON.stringify(result));
  } catch {
    // The live Zustand result remains available when browser storage is unavailable.
  }
}

export function loadMissionResultSession(
  gameRoomId: string | undefined,
  storage: MissionResultStorage | null = getBrowserSessionStorage(),
) {
  if (!gameRoomId || !storage) {
    return null;
  }

  try {
    const serialized = storage.getItem(getMissionResultStorageKey(gameRoomId));
    if (!serialized) {
      return null;
    }

    const parsed: unknown = JSON.parse(serialized);
    return isMissionResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearMissionResultSession(
  gameRoomId: string,
  storage: MissionResultStorage | null = getBrowserSessionStorage(),
) {
  try {
    storage?.removeItem?.(getMissionResultStorageKey(gameRoomId));
  } catch {
    // A stale result is harmless when browser storage cannot be updated.
  }
}
