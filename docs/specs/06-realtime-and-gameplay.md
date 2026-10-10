# Realtime And Gameplay

## Waiting Room Display

The waiting-room UI lives inside `/main` and shows:

- room status
- room difficulty
- current participant count
- turn time limit
- max strike count
- minimum and maximum participant counts
- my role
- my membership status
- participant membership states
- recent participant change summary
- the start-game action for the owner

Start button rules:

```ts
const canShowStartButton = currentRoom.myRole === "OWNER";

const canClickStartButton =
  canShowStartButton &&
  currentRoom.status === "WAITING" &&
  currentRoom.joinedParticipantCount >= currentRoom.minParticipants;
```

## Start Game API

```txt
POST /game-rooms/{gameRoomId}/start
```

```ts
export type StartGameRequest = {
  missionTemplateId?: string;
};

export type StartGameResponse = {
  success: boolean;
};
```

Rules:

- do not build gameplay state from this response alone
- wait for `game-started`
- route to `/rooms/:gameRoomId/play` only when realtime `uiHints.enterGameScreen = true`

## Gameplay Screen

The gameplay page contains:

- game status header
- mission title and description
- difficulty and language
- current turn number
- current player
- remaining time
- strike count
- file tabs
- Monaco editor
- turn submit button
- hint button
- turn evaluation panel
- final mission result panel
- participant status panel

Resolved contract:

- `missionState.projectStructure.files` provides the editor file-tab metadata
- the shared API spec does not define a separate `fileUrl` bootstrap contract for editor content

## Editability Rule

```ts
const canEdit =
  gameState.turnState?.currentPlayerId === authUser.userId &&
  gameState.turnState.status === "IN_PROGRESS";
```

## Realtime Transport Envelope

The frontend uses a raw browser `WebSocket` connection to the backend root realtime endpoint derived from `VITE_SOCKET_URL`.

Transport rules:

- open the websocket first, then send `join-room` as the first application message
- authenticate inside the `join-room` payload, not in the websocket handshake
- parse and serialize application frames as a normalized `{ event, data }` envelope inside `shared/socket`
- keep reducers and page orchestration focused on canonical event names and typed payloads rather than raw websocket message parsing

Normalized frame shape:

```json
{
  "event": "event-name",
  "data": {}
}
```

## Realtime Outbound Events

`join-room`

```ts
export type JoinRoomEvent = {
  accessToken: string;
  gameRoomId: string;
  userId: string;
};
```

Realtime send rule:

- `join-room` is the first application frame after the raw websocket reaches the open state
- the backend derives the authoritative user from `accessToken`; `userId` remains product payload context, not a trusted auth primitive

`code-change`

```ts
export type CodeChangeEvent = {
  gameRoomId: string;
  userId: string;
  sessionId: string;
  filePath: string;
  codeDelta: Record<string, unknown>;
  occurredAt: string;
};
```

Resolved contract:

- incremental realtime sync uses `codeDelta` payloads on `code-change` / `code-updated`
- optional `content` on inbound `code-updated` may carry a full-file authoritative snapshot for turn bootstrap; do not infer it from `codeDelta`
- `sessionId` is best-effort client/session metadata, not a guaranteed server-issued socket identifier
- CRDT/Yjs is out of scope for the MVP

`turn-submit`

```ts
export type TurnSubmitEvent = {
  gameRoomId: string;
  userId: string;
  turnId: string;
  codeSnapshot: CodeSnapshot;
  submittedAt: string;
};
```

## Realtime Inbound Events

`room-participants-updated`

- store participants
- show the latest membership change
- persist the included `gameState` and `missionState`
- keep the waiting-room UI when the room is still `WAITING`

`game-started`

- enter gameplay
- persist `gameState` and `missionState`
- apply mission guide UI hints
- build editor tabs from `missionState.projectStructure.files`
- initialize timer and current player

`code-updated`

```ts
export type CodeUpdatedEvent = {
  gameRoomId: string;
  userId: string;
  sessionId?: string;
  filePath: string;
  codeDelta: Record<string, unknown>;
  content?: string;
  occurredAt: string;
};
```

- apply remote file changes from `codeDelta`
- when `content` is present, merge it into authoritative editor state for baseline/reset
- suppress echo only when `sessionId` is present and matches the connected client's `realtime.socketId`
- omitting `sessionId` is accepted for legacy servers; do not drop the whole event
- do not treat matching `userId` alone as same-client suppression

`turn-evaluated`

- show the completed turn result
- update feedback, strikes, and detected issues
- treat `SUBMITTED` and `TIMEOUT` evaluations with the same display flow
- on `FAILED`, decrement one team strike through the authoritative backend result
- keep the failed submission only as an attempt record; it must not become the next editor baseline
- restore every participant to the latest `PASSED` snapshot, or the mission starter files when no step has passed yet
- keep the current mission step active so the next player retries the same step
- treat evaluator `ERROR` separately from `FAILED`; do not consume a strike or advance the turn

`turn-changed`

- update the active player and timer
- switch the editor between writable and read-only modes

`game-state-updated`

- refresh game state
- update strike and mission UI, including `missionState` when present
- prepare result routing when status becomes `FINISHED`

`mission-result`

- display the final mission outcome
- route to `/rooms/:gameRoomId/result`
- treat in-memory event state as the primary source because there is no separate result API

## Game Item MVP Contract (TASK 1)

This section defines the target contract for subsequent implementation tasks; it does not indicate that runtime support is already implemented. It applies equally to multiplayer and personal practice. Only `TIME_EXTENSION_30` is in scope; shield and turn-pass effects are deferred.

### Wire types and delivery

All messages use the existing `{ event, data }` WebSocket envelope, without the HTTP response wrapper. Server timestamps use ISO 8601 with the `+09:00` offset, following the timestamp policy.

```ts
type GameItemType = "TIME_EXTENSION_30";

type GameItemUsePayload = {
  gameRoomId: string;
  turnId: string;
  itemType: GameItemType;
};

type GameItemUsedEvent = {
  gameRoomId: string;
  turnId: string;
  itemType: GameItemType;
  usedBy: { userId: string; nickname: string };
  remainingQuantity: number;
  effect: { addedSeconds: 30; deadlineAt: string };
  occurredAt: string;
};

type GameItemErrorCode =
  | "INVALID_GAME_ITEM_REQUEST"
  | "AUTH_REQUIRED"
  | "FORBIDDEN_RESOURCE_ACCESS"
  | "GAME_ROOM_NOT_FOUND"
  | "GAME_ROOM_NOT_IN_PROGRESS"
  | "TURN_MISMATCH"
  | "TURN_PLAYER_REQUIRED"
  | "TURN_NOT_IN_PROGRESS"
  | "TURN_DEADLINE_EXPIRED"
  | "GAME_ITEM_EXHAUSTED"
  | "GAME_ITEM_INTERNAL_ERROR";

type GameItemErrorEvent = {
  gameRoomId: string | null;
  turnId: string | null;
  itemType: GameItemType | null;
  code: GameItemErrorCode;
  message: string;
  occurredAt: string;
};

type GameItemState = {
  itemType: GameItemType;
  remainingQuantity: number;
};
```

- `game-item-use`: client -> server. Room and turn IDs must be valid UUID strings; `itemType` must exactly match the supported literal.
- `game-item-used`: server -> all currently connected, authorized sockets in the room, including the requester; emitted only after the database transaction commits.
- `game-item-error`: server -> requesting socket only. Do not broadcast errors or expose database/internal exception details.
- Resolve `usedBy` from the authenticated socket session and server user data, never from client-supplied identity.
- The request has no request ID. Allow at most one pending item request per client. Correlate results using `(gameRoomId, turnId, itemType)`; this tuple is not a unique delivery ID and success replay is not guaranteed.
- Error correlation fields contain only syntactically valid supplied values; absent/invalid IDs and unsupported item types are `null`. Null fields do not authorize any room access.

### Validation and errors

Validate request shape first, then authentication and room authorization before revealing room or turn state. For an authorized request, check room status, turn identity/status, actor, deadline, then inventory. When multiple conditions fail, return the first failure in this order.

| Code | Condition |
|---|---|
| `INVALID_GAME_ITEM_REQUEST` | Missing/invalid IDs, malformed payload, or unsupported item type. |
| `AUTH_REQUIRED` | No authenticated session established by `join-room`. |
| `FORBIDDEN_RESOURCE_ACCESS` | Requested room differs from the bound socket room, or the user no longer has active `JOINED` membership. |
| `GAME_ROOM_NOT_FOUND` | Authorized socket's room no longer exists. |
| `GAME_ROOM_NOT_IN_PROGRESS` | Room is not `IN_PROGRESS`. |
| `TURN_MISMATCH` | Turn does not exist, belongs to another room, or an in-progress requested turn is not the room's current turn. |
| `TURN_NOT_IN_PROGRESS` | Requested room turn has already been submitted or timed out. |
| `TURN_PLAYER_REQUIRED` | Authenticated user is not the current turn player. |
| `TURN_DEADLINE_EXPIRED` | Server time is greater than or equal to the stored deadline. |
| `GAME_ITEM_EXHAUSTED` | Inventory row is absent or remaining quantity is zero. |
| `GAME_ITEM_INTERNAL_ERROR` | Unexpected processing failure; outcome may be unknown to the client and requires state resynchronization. |

An item rejection does not itself close the socket. Existing `join-room` authentication/access failures retain their close-code behavior. A failure to deliver an event after commit must not undo inventory, report a definite rollback, or automatically execute the use again.

### Server authority and concurrency

- One item is shared by the whole room for its entire game, not one per participant, turn, or mission step.
- Create the item in the successful game-start transaction. Repeated starts, state reads, new turns, reconnects, and server restarts never refill inventory.
- Lock the turn row, validate current state and deadline, then lock the inventory row. Decrement quantity, increment used count, and add exactly 30 seconds to the stored `deadlineAt` in the same transaction. Roll back all changes on failure.
- Capture server time after acquiring the turn lock; do not use request time, a pre-lock timestamp, or a transaction-start timestamp that predates lock waiting. The eligibility boundary is `serverNow < deadlineAt`.
- Submission and expiration must coordinate on the same turn row lock. Expiration must re-read the deadline under that lock; a stale expiration candidate must not close an extended turn. Disconnect-forced completion remains distinct from deadline expiration.
- The first concurrent use may succeed; later attempts must not consume again or add another 30 seconds. A repeat can return the applicable current-state error, not necessarily `GAME_ITEM_EXHAUSTED`.
- `occurredAt` is the server effect timestamp. `startedAt` and the configured `timeLimitSeconds` do not change; only the authoritative deadline extends.

### State snapshots, recovery, and deployment

- After this feature is implemented, full `gameState` snapshots in `game-started`, `room-participants-updated`, and `game-state-updated` include `items: GameItemState[]` sourced from persisted inventory.
- For MVP, each such snapshot includes exactly one `TIME_EXTENSION_30` entry. Waiting rooms and rooms without an inventory row report `remainingQuantity: 0`; a successful new game reports `1`; a consumed item reports `0`. This normalized view does not create a database row.
- A snapshot must present a consistent committed view of item quantity and the current turn deadline. A finished room still exposes its remaining item quantity but cannot accept item use.
- To recover a missing response while connected, send the existing `join-room` payload on the same socket and wait for `room-participants-updated`. This is a read/resynchronization operation, not another item-use request; it must not repeat membership mutations or reset the game.
- On an authorized new connection, `join-room` returns the same database-backed snapshot. Inventory and deadline survive application-server restart; expiration after restart uses the persisted deadline and current server time, without refunding consumed items.
- Existing disconnect policy marks a participant `LEFT` and may terminate the turn or room. Durable item restoration does not grant re-entry, restore `JOINED`, or resurrect a finished game. Seamless reconnection/grace-period changes are a separate lifecycle feature; rejected joins follow the existing exit/error UX. TASK 7 must verify both authorized restoration and denied re-entry.
- PostgreSQL storage must be persistent to guarantee recovery across database/container restart. Development PostgreSQL now uses a named volume. TASK 10 verified backup/restore preservation and item durability through PostgreSQL container recreation.
- Games already started before the feature deployment receive no retroactive item. Waiting rooms that start after deployment receive one. Missing inventory must never trigger lazy creation during use or recovery.
- During rollout, an absent `items` field means inventory is unknown: disable item use until an authoritative snapshot is available. Do not infer a free item. An omitted field in a partial update preserves known inventory; a room change clears the previous room's inventory.

### Client behavior

- Enable use only when the room/turn is in progress, the local user is the current player, authoritative inventory is positive, the displayed deadline is unexpired, the socket is ready, and neither an item request nor turn submission is pending. The server remains the final authority.
- Do not optimistically change quantity or deadline. Assign the returned `remainingQuantity` and absolute `effect.deadlineAt`; never implement success by adding 30 seconds to the local countdown.
- For the same room, a late success for an old turn can reduce inventory but must not replace the current turn or its deadline. Ignore other-room events. A success cannot change a completed turn back to `IN_PROGRESS`.
- Duplicate events are harmless assignments. Within the same game, quantity never increases after initialization; within the same active turn, an older snapshot must not shorten an already-confirmed extended deadline. Completed state must not be reopened by stale events.
- Show a readable error based on `code`/`message`. Use the correlation tuple to avoid clearing a different pending request.
- If no result arrives within 10 seconds, or the socket disconnects, clear the pending spinner and mark inventory as awaiting synchronization; keep use disabled. Do not assume success or failure and do not automatically resend `game-item-use`.
- Restore known quantity and deadline only from server state. If synchronization also fails, keep use disabled and offer state synchronization retry, not automatic item retry.
- Compute countdown from the server deadline. Mission-guide/start-countdown presentation must not add local bonus time beyond that deadline.

### Contract examples

Request:

```json
{"event":"game-item-use","data":{"gameRoomId":"00000000-0000-4000-8000-000000000001","turnId":"00000000-0000-4000-8000-000000000002","itemType":"TIME_EXTENSION_30"}}
```

Success (the previous deadline was `2026-10-10T12:00:30+09:00`):

```json
{"event":"game-item-used","data":{"gameRoomId":"00000000-0000-4000-8000-000000000001","turnId":"00000000-0000-4000-8000-000000000002","itemType":"TIME_EXTENSION_30","usedBy":{"userId":"00000000-0000-4000-8000-000000000003","nickname":"player1"},"remainingQuantity":0,"effect":{"addedSeconds":30,"deadlineAt":"2026-10-10T12:01:00+09:00"},"occurredAt":"2026-10-10T12:00:20+09:00"}}
```

Rejected repeat while the same turn is still active and unexpired:

```json
{"event":"game-item-error","data":{"gameRoomId":"00000000-0000-4000-8000-000000000001","turnId":"00000000-0000-4000-8000-000000000002","itemType":"TIME_EXTENSION_30","code":"GAME_ITEM_EXHAUSTED","message":"No time extension items remain in this room.","occurredAt":"2026-10-10T12:00:21+09:00"}}
```

Relevant `gameState` fragment in the full `room-participants-updated` snapshot after an authorized rejoin (other existing fields remain unchanged):

```json
{"items":[{"itemType":"TIME_EXTENSION_30","remainingQuantity":0}],"turnState":{"turnId":"00000000-0000-4000-8000-000000000002","turnNumber":1,"currentPlayerId":"00000000-0000-4000-8000-000000000003","startedAt":"2026-10-10T12:00:00+09:00","deadlineAt":"2026-10-10T12:01:00+09:00","timeLimitSeconds":30,"remainingTimeSeconds":35,"status":"IN_PROGRESS"}}
```

The fragment assumes server time `2026-10-10T12:00:25+09:00`. It restores zero inventory and 35 remaining seconds without replaying the item success or granting another item.
