import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roomPagePath = new URL("../../src/pages/RoomPage/index.tsx", import.meta.url);

test("RoomPage keeps its store hooks unconditional after a practice turn update", async () => {
  const source = await readFile(roomPagePath, "utf8");

  assert.match(
    source,
    /const currentRoomMode = useAppStore\(\(state\) => state\.room\.currentRoom\?\.mode\);/,
  );
  assert.match(
    source,
    /gameState\?\.mode === "PRACTICE" \|\|\s*currentRoomMode === "PRACTICE"/,
  );
  assert.doesNotMatch(
    source,
    /gameState\?\.mode === "PRACTICE"\s*\|\|\s*useAppStore\(/,
  );
});

test("RoomPage supplies a stable empty editor-file fallback to gameplay code sync", async () => {
  const source = await readFile(roomPagePath, "utf8");

  assert.match(
    source,
    /const editorFiles = useAppStore\(\(state\) => state\.editor\.files\) \?\? emptyEditorFiles;/,
  );
  assert.match(source, /editorFiles,\s*\}\);/);
});
