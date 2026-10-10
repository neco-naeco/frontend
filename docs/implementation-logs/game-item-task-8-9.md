# Game item MVP — TASK 8–9

Completed 2026-10-10.

## TASK 8: Client events and state

- Added typed item requests, success/error payloads, inventory, and request state.
- Send `game-item-use` once per pending request. Keep inventory and deadline unchanged until the server confirms success.
- Apply absolute server deadlines and quantities; ignore other rooms and malformed successes. Old-turn successes only affect shared stock, and duplicates do not add time again.
- Preserve consumed inventory, extended deadlines, and completed turns against stale snapshots. Waiting-room snapshots cannot reinitialize an active game's inventory.
- After 10 seconds without a result, clear pending and request `join-room` on the existing socket. Synchronization has its own 10-second timeout and explicit retry. Never retry item use automatically.
- Disconnect clears pending, cancels recovery timers, detaches item handlers, and requires synchronization. Switching rooms clears prior inventory.
- Same-turn synchronization preserves editor drafts. A new-turn snapshot updates the editor's authoritative baseline.

## TASK 9: Item control and timer

- Added the shared `시간 +30초` button, remaining quantity, disabled reasons, pending state, success/error message, and state-retry action.
- Enable only with known positive stock, a connected socket, an active unexpired turn owned by the user, and no submission/item request pending. The mission-guide overlay also prevents clicking the button.
- Use the server deadline for the timer even while the guide/start countdown is displayed. Removed the gameplay UI's local countdown bonus and timer freeze.
- Kept the existing visual style, added keyboard focus indicators, live result text, and wrapping layout for narrow screens.

## Verification

- `npm test`: 469 tests passed, including 15 new item tests covering multiplayer/practice, duplicate clicks/events, stale state, correlation, timeout/retry, disconnect, room changes, and editor restoration.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npx vite build`: passed.
- Impeccable detector on changed RoomPage UI files: no findings.
- Playwright with local Chrome and a temporary isolated state fixture: desktop 1440px and mobile 390px inspected; button eligibility, consumed stock/disabled state, and item-bar bounds passed; no browser runtime errors. Removed temporary fixture files afterward.
- `git diff --check`: passed.

## Verification limits

- `npm run build` remains blocked by pre-existing Vite configuration typing: missing Node types for `process` and missing ES2015 library support for `startsWith` in `tsconfig.node.json`. These files are unchanged by TASK 8–9. The application typecheck and Vite bundling passed separately.
- Browser verification used injected server state, not a real multi-client backend session. The running backend Docker image has not been rebuilt for the item feature. End-to-end deployment/restart checks and persistent PostgreSQL storage remain TASK 10.

## TASK 10 follow-up (2026-10-10)

The previous Vite config type errors are resolved by declaring Node types and an ES2022 target. Full `npm run build` and all 469 frontend tests now pass. The backend image is rebuilt; live WebSocket checks and app/PostgreSQL container recovery passed. PostgreSQL now uses a named volume migrated through a verified backup/restore. See `backend/docs/operations/postgres-storage.md` in the sibling backend repository for storage and smoke-test instructions.
