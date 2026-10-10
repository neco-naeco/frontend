import test from "node:test";
import assert from "node:assert/strict";
import { createAppStore } from "../../src/app/store/clientState.ts";
import { applyGameItemUsed, applyGameItemError, mergeItemGameState, itemDisabledReason, createGameItemActions, snapshotItemUse } from "../../src/features/game-items/gameItemState.ts";
import { applyRoomParticipantsUpdatedWithNavigation } from "../../src/features/realtime/realtimeEventReducers.ts";
import { bindRoomRealtimeEvents } from "../../src/features/realtime/roomRealtimeEvents.ts";
const request = { gameRoomId: "room", turnId: "turn", itemType: "TIME_EXTENSION_30" };
function fixture(mode = "MULTIPLAYER") {
  const store = createAppStore();
  store.setState(s => ({ ...s, auth: { ...s.auth, user: { userId: "me" } },
    realtime: { ...s.realtime, activeRoomId: "room", connectionStatus: "connected" },
    game: { ...s.game, gameState: { status: "IN_PROGRESS", mode,
      items: [{ itemType: request.itemType, remainingQuantity: 1 }],
      turnState: { turnId: "turn", turnNumber: 1, currentPlayerId: "me", status: "IN_PROGRESS", deadlineAt: new Date(Date.now()+60000).toISOString() },
    } },
  }));
  return store;
}
function success(state, extra = {}) {
  return { ...request, usedBy: { userId: "me", nickname: "플레이어" }, remainingQuantity: 0,
    effect: { addedSeconds: 30, deadlineAt: new Date(Date.parse(state.game.gameState.turnState.deadlineAt)+30000).toISOString() }, occurredAt: new Date().toISOString(), ...extra };
}
for (const mode of ["MULTIPLAYER", "PRACTICE"]) test(`${mode}: request has no optimistic effect and duplicate clicks emit once`, () => {
  const store = fixture(mode); const initial = store.getState().game.gameState; const sent=[];
  const actions = createGameItemActions(store, (...args) => { sent.push(args); return true; }, () => true);
  try {
    assert.equal(actions.useGameItem(), true); assert.equal(actions.useGameItem(), false);
    assert.equal(store.getState().game.gameState, initial); assert.deepEqual(sent, [["game-item-use",request]]);
    const event=success(store.getState()); store.setState(applyGameItemUsed(store.getState(), event));
    assert.equal(store.getState().game.itemUse.status,"ready");
    assert.equal(store.getState().game.gameState.turnState.deadlineAt,event.effect.deadlineAt);
    assert.deepEqual(applyGameItemUsed(store.getState(), event),store.getState());
    assert.equal(actions.useGameItem(), false);
  } finally { actions.dispose(); }
});
test("old turn success consumes shared stock without replacing current turn; other room ignored", () => {
  const state=fixture().getState(); const event=success(state,{turnId:"old"});
  const next=applyGameItemUsed(state,event);
  assert.equal(next.game.gameState.items[0].remainingQuantity,0);
  assert.equal(next.game.gameState.turnState,state.game.gameState.turnState);
  assert.equal(applyGameItemUsed(state,{...event,gameRoomId:"other"}),state);
  assert.equal(applyGameItemUsed(state,{...event,effect:{}}),state);
});
test("stale snapshots cannot refill inventory, shorten deadline, regress turns or reopen finished game", () => {
  const original=fixture().getState(); const used=applyGameItemUsed(original,success(original)).game.gameState;
  const merged=mergeItemGameState(used,original.game.gameState);
  assert.equal(merged.items[0].remainingQuantity,0); assert.equal(merged.turnState.deadlineAt,used.turnState.deadlineAt);
  assert.equal(mergeItemGameState({...used,status:"FINISHED"},original.game.gameState).status,"FINISHED");
  assert.equal(mergeItemGameState(used,{...used,turnState:{...used.turnState,turnNumber:0}}).turnState.turnNumber,1);
  assert.equal(mergeItemGameState({status:"WAITING",items:used.items},original.game.gameState).items[0].remainingQuantity,1);
  assert.equal(mergeItemGameState(used,{status:"IN_PROGRESS"}).items[0].remainingQuantity,0);
});
test("eligibility checks unknown stock, socket, actor, expired turn, ended game and submission", () => {
  const state=fixture().getState(); assert.equal(itemDisabledReason(state),null);
  for (const mutate of [s=>s.game.gameState.items=undefined,s=>s.realtime.connectionStatus="closed",s=>s.auth.user.userId="other",s=>s.game.gameState.turnState.deadlineAt=new Date(0).toISOString(),s=>s.game.gameState.status="FINISHED",s=>s.game.turnSubmissionPending=true,s=>s.game.gameState.turnState.status="SUBMITTED"]) {
    const s=structuredClone(state); mutate(s); assert.ok(itemDisabledReason(s));
  }
});
test("errors only clear the correlated pending request and require synchronization", () => {
  const state=fixture().getState(); state.game.itemUse={status:"pending",pending:request,message:null};
  const error={...request,code:"GAME_ITEM_EXHAUSTED",message:"exhausted"};
  assert.equal(applyGameItemError(state,{...error,turnId:"old"}),state);
  const next=applyGameItemError(state,error); assert.equal(next.game.itemUse.pending,null);
  assert.equal(next.game.itemUse.status,"needs-sync"); assert.equal(next.game.gameState,state.game.gameState);
});
test("10s timeout requests state only, second timeout allows sync retry without item retry", t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const store=fixture(); const sent=[]; let syncs=0;
  const actions=createGameItemActions(store,(...args)=>{sent.push(args);return true;},()=>{syncs++;return true;});
  actions.useGameItem(); t.mock.timers.tick(10000);
  assert.equal(store.getState().game.itemUse.status,"syncing"); assert.equal(syncs,1); assert.equal(sent.length,1);
  assert.equal(actions.useGameItem(),false); t.mock.timers.tick(10000);
  assert.equal(store.getState().game.itemUse.status,"needs-sync");
  actions.syncGameItems(); assert.equal(syncs,2); assert.equal(sent.length,1); actions.dispose();
});
test("failed send stays disabled until a valid authoritative snapshot", () => {
  const store=fixture(); const actions=createGameItemActions(store,()=>false,()=>false);
  actions.useGameItem(); assert.equal(store.getState().game.itemUse.status,"needs-sync");
  assert.equal(actions.useGameItem(),false);
  assert.equal(snapshotItemUse(store.getState(),{status:"IN_PROGRESS"}).status,"needs-sync");
  assert.equal(snapshotItemUse(store.getState(),store.getState().game.gameState).status,"ready"); actions.dispose();
});
test("resync preserves editor drafts and restores quantity/deadline", () => {
  const state=fixture().getState(); state.game.missionState={missionId:"mission"}; state.editor.files={"main.ts":"draft"};
  state.game.itemUse={status:"syncing",pending:null,message:null};
  const gameState=applyGameItemUsed(state,success(state)).game.gameState;
  const result=applyRoomParticipantsUpdatedWithNavigation(state,{gameRoomId:"room",gameState,missionState:state.game.missionState,participants:[]});
  assert.equal(result.state.editor,state.editor); assert.equal(result.navigationTarget,null);
  assert.equal(result.state.game.gameState.items[0].remainingQuantity,0); assert.equal(result.state.game.itemUse.status,"ready");
});
test("item socket handlers are detached on cleanup", () => {
  const store=fixture(); const handlers=new Map(); const socket={on:(name,fn)=>handlers.set(name,fn),off:name=>handlers.delete(name)};
  const unbind=bindRoomRealtimeEvents(socket,store); handlers.get("game-item-used")(success(store.getState()));
  assert.equal(store.getState().game.gameState.items[0].remainingQuantity,0); unbind(); assert.equal(handlers.size,0);
});

test("disconnect clears pending and cancels recovery timer; room changes clear inventory", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const {createStoreBackedRoomSocketLifecycleController}=await import("../../src/features/realtime/roomSocketLifecycle.ts");
  const store=fixture(); const handlers=new Map(); const emitted=[];
  const socket={on:(name,fn)=>handlers.set(name,fn),off:name=>handlers.delete(name),connect(){},disconnect(){},emit:(name,data)=>emitted.push({name,data})};
  const controller=createStoreBackedRoomSocketLifecycleController(store,()=>socket);
  const currentRoom={gameRoomId:"room",status:"IN_PROGRESS",myMembershipStatus:"JOINED"};
  const input={currentRoom,accessToken:"token",userId:"me",routeGameRoomId:"room",socketUrl:"ws://test"};
  controller.sync(input); handlers.get("connect")();
  store.setState(s=>({...s,game:{...s.game,itemUse:{status:"ready",pending:null,message:null}}}));
  assert.equal(controller.useGameItem(),true); handlers.get("disconnect")("1006");
  assert.equal(store.getState().game.itemUse.pending,null); assert.equal(store.getState().game.itemUse.status,"needs-sync");
  t.mock.timers.tick(20000); assert.deepEqual(emitted.map(e=>e.name),["join-room","game-item-use"]);
  assert.equal(handlers.has("game-item-used"),false);
  controller.sync({...input,currentRoom:{...currentRoom,gameRoomId:"other"},routeGameRoomId:"other"});
  assert.equal(store.getState().game.gameState,null); controller.leave("other");
});

test("state retry reuses join-room on the same socket without using the item again", async () => {
  const {createStoreBackedRoomSocketLifecycleController}=await import("../../src/features/realtime/roomSocketLifecycle.ts");
  const store=fixture(); const handlers=new Map(); const emitted=[]; let created=0;
  const socket={on:(name,fn)=>handlers.set(name,fn),off:name=>handlers.delete(name),connect(){},disconnect(){},emit:(name,data)=>emitted.push({name,data})};
  const controller=createStoreBackedRoomSocketLifecycleController(store,()=>{created++;return socket;});
  controller.sync({currentRoom:{gameRoomId:"room",status:"IN_PROGRESS",myMembershipStatus:"JOINED"},accessToken:"token",userId:"me",routeGameRoomId:"room",socketUrl:"ws://test"});
  handlers.get("connect")(); assert.equal(controller.syncGameItems(),true);
  assert.equal(created,1); assert.deepEqual(emitted.map(e=>e.name),["join-room","join-room"]);
  assert.deepEqual(emitted[1].data,emitted[0].data); controller.leave("room");
});

test("late waiting snapshot cannot allow the game to initialize inventory twice", () => {
  const original=fixture().getState(); const used=applyGameItemUsed(original,success(original)).game.gameState;
  const stale=mergeItemGameState(used,{status:"WAITING",items:[{itemType:request.itemType,remainingQuantity:0}]});
  assert.equal(stale.status,"IN_PROGRESS");
  assert.equal(mergeItemGameState(stale,original.game.gameState).items[0].remainingQuantity,0);
});

test("completed turn stays completed after late success or older active snapshot", () => {
  const state=fixture().getState(); state.game.gameState.turnState.status="SUBMITTED";
  const used=applyGameItemUsed(state,success(state));
  assert.equal(used.game.gameState.turnState.status,"SUBMITTED");
  const older={...state.game.gameState,turnState:{...state.game.gameState.turnState,status:"IN_PROGRESS"}};
  assert.equal(mergeItemGameState(used.game.gameState,older).turnState.status,"SUBMITTED");
});

test("a resync into a new turn advances the editor baseline with the server snapshot", () => {
  const state=fixture().getState(); state.game.missionState={missionId:"mission"};
  state.editor.files={"main.ts":"draft"}; state.editor.authoritativeFiles={"main.ts":"old"};
  state.editor.turnBaselineTurnId="turn"; state.editor.turnBaselineReady=true;
  const gameState={...state.game.gameState,turnState:{...state.game.gameState.turnState,turnId:"next",turnNumber:2}};
  const missionState={missionId:"mission",projectStructure:{entryFilePath:"main.ts",files:[{filePath:"main.ts",content:"server",language:"typescript",readonly:false}]}};
  const {state:next}=applyRoomParticipantsUpdatedWithNavigation(state,{gameRoomId:"room",gameState,missionState,participants:[]});
  assert.equal(next.game.gameState.turnState.turnId,"next");
  assert.equal(next.editor.turnBaselineTurnId,"next");
  assert.equal(next.editor.authoritativeFiles["main.ts"],"server");
});
