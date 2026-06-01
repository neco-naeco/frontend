import test from "node:test";
import assert from "node:assert/strict";
import {
  createMainPageMockApi,
  getMainPageMockScenario,
  isMainPageMockModeEnabled,
  MAIN_PAGE_MOCK_USER,
} from "../../src/pages/MainPage/mockMode.ts";

test("getMainPageMockScenario reads supported mock scenarios from the query string", () => {
  assert.equal(getMainPageMockScenario("?mock=room-create"), "room-create");
  assert.equal(getMainPageMockScenario("?mock=room-create-delay"), "room-create-delay");
  assert.equal(getMainPageMockScenario("?mock=invitation"), "invitation");
  assert.equal(getMainPageMockScenario("?mock=invitation-delay"), "invitation-delay");
  assert.equal(getMainPageMockScenario("?mock=start-ready"), "start-ready");
  assert.equal(getMainPageMockScenario("?mock=presentation-owner"), "presentation-owner");
  assert.equal(getMainPageMockScenario("?mock=presentation-guest"), "presentation-guest");
  assert.equal(getMainPageMockScenario("?mock=unknown"), null);
  assert.equal(isMainPageMockModeEnabled("?mock=room-create"), true);
  assert.equal(isMainPageMockModeEnabled("?mock=invitation"), true);
  assert.equal(isMainPageMockModeEnabled("?mock=start-ready"), true);
  assert.equal(isMainPageMockModeEnabled("?debug=scroll"), false);
});

test("presentation owner scenario creates a room and waits for the invited guest", async () => {
  const api = createMainPageMockApi("presentation-owner");
  const [session] = await api.getSessions("presentation-owner");

  await api.sendMessage(session.aiChatSessionId, {
    message: "방 만들어줘",
  });
  await api.sendMessage(session.aiChatSessionId, {
    message: "쉬운 난이도로 방 만들어줘.",
  });
  const createRoomResponse = await api.sendMessage(session.aiChatSessionId, {
    message: "문자열 뒤집기 템플릿으로 진행할게요.",
  });
  assert.equal(
    createRoomResponse.assistantMessage?.content,
    "방이 생성되었어요! 친구들을 초대해보세요.",
  );

  const inviteResponse = await api.sendMessage(session.aiChatSessionId, {
    message: "성민, 수현, 현, 정화 초대해줘.",
  });
  const [room] = await api.getCurrentRooms("presentation-owner");
  const participants = await api.getRoomParticipants(room.gameRoomId);

  assert.equal(inviteResponse.requestType, "USER_INVITE");
  assert.equal(inviteResponse.commandResult?.status, "SUCCESS");
  assert.deepEqual(inviteResponse.commandResult?.participants, ["성민", "수현", "현", "정화"]);
  assert.equal(
    inviteResponse.assistantMessage?.content,
    "성민, 수현, 현, 정화님에게 초대가 전송되었어요. 친구가 초대를 수락하면 알려드릴게요.",
  );
  assert.equal(room.myRole, "OWNER");
  assert.equal(room.joinedParticipantCount, 1);
  assert.equal(room.maxParticipants, 5);
  assert.deepEqual(
    participants.map((participant) => participant.nickname),
    ["현하"],
  );
  assert.deepEqual(await api.startGame(room.gameRoomId), { success: true });
});

test("presentation guest scenario accepts an invitation and shows the completed waiting room", async () => {
  const previousWindow = globalThis.window;
  const storage = new Map([["neconaeco:presentation-invitees", '["성민"]']]);

  globalThis.window = {
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  };

  try {
    const api = createMainPageMockApi("presentation-guest");
    const [session] = await api.getSessions("presentation-guest");
    const invitations = await api.getInvitedParticipants("presentation-guest");

    assert.equal(invitations.length, 1);
    assert.equal(invitations[0].nickname, "현하");

    const response = await api.sendMessage(session.aiChatSessionId, {
      message: "문자열 핸들링 릴레이 방 초대 수락할게요.",
    });
    const [room] = await api.getCurrentRooms("presentation-guest");
    const participants = await api.getRoomParticipants(room.gameRoomId);

    assert.equal(response.requestType, "ROOM_JOIN");
    assert.equal(room.myRole, "PARTICIPANT");
    assert.equal(room.joinedParticipantCount, 2);
    assert.deepEqual(
      participants.map((participant) => participant.nickname),
      ["현하", "성민"],
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("presentation guest acceptance updates the owner waiting room and appends an entry notice", async () => {
  const previousWindow = globalThis.window;
  const storage = new Map();

  globalThis.window = {
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  };

  try {
    const guestApi = createMainPageMockApi("presentation-guest");
    const [guestSession] = await guestApi.getSessions("presentation-guest");

    assert.deepEqual(await guestApi.getInvitedParticipants("presentation-guest"), []);

    const ownerApi = createMainPageMockApi("presentation-owner");
    const [ownerSession] = await ownerApi.getSessions("presentation-owner");

    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "방 만들어줘",
    });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "쉬운 난이도로 방 만들어줘.",
    });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "문자열 뒤집기 템플릿으로 진행할게요.",
    });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "성민, 수현, 현, 정화 초대해줘.",
    });

    const guestInvitations = await guestApi.getInvitedParticipants("presentation-guest");

    assert.equal(guestInvitations.length, 1);
    assert.equal(guestInvitations[0].nickname, "현하");

    await guestApi.sendMessage(guestSession.aiChatSessionId, {
      message: "문자열 핸들링 릴레이 방 초대 수락할게요.",
    });

    const [ownerRoom] = await ownerApi.getCurrentRooms("presentation-owner");
    const ownerParticipants = await ownerApi.getRoomParticipants(ownerRoom.gameRoomId);
    const ownerMessages = await ownerApi.getMessages(ownerSession.aiChatSessionId);

    assert.equal(ownerRoom.joinedParticipantCount, 2);
    assert.deepEqual(
      ownerParticipants.map((participant) => participant.nickname),
      ["현하", "성민"],
    );
    assert.equal(
      ownerMessages.at(-1)?.content,
      "'성민'님이 입장했습니다.",
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test("presentation guests join the owner waiting room one by one", async () => {
  const previousWindow = globalThis.window;
  const storage = new Map();

  globalThis.window = {
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      removeItem(key) {
        storage.delete(key);
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  };

  try {
    const ownerApi = createMainPageMockApi("presentation-owner");
    const [ownerSession] = await ownerApi.getSessions("presentation-owner");

    await ownerApi.sendMessage(ownerSession.aiChatSessionId, { message: "방 만들어줘" });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "쉬운 난이도로 방 만들어줘.",
    });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "문자열 뒤집기 템플릿으로 진행할게요.",
    });
    await ownerApi.sendMessage(ownerSession.aiChatSessionId, {
      message: "성민, 수현, 현, 정화 초대해줘.",
    });

    for (const [index, nickname] of ["성민", "수현", "현", "정화"].entries()) {
      const guestApi = createMainPageMockApi(
        "presentation-guest",
        `presentation-guest-${nickname}`,
        nickname,
      );
      const [guestSession] = await guestApi.getSessions(nickname);

      assert.equal((await guestApi.getInvitedParticipants(nickname)).length, 1);
      await guestApi.sendMessage(guestSession.aiChatSessionId, {
        message: "초대 수락할게요.",
      });

      const [ownerRoom] = await ownerApi.getCurrentRooms("presentation-owner");
      const ownerParticipants = await ownerApi.getRoomParticipants(ownerRoom.gameRoomId);

      assert.equal(ownerRoom.joinedParticipantCount, index + 2);
      assert.deepEqual(
        ownerParticipants.map((participant) => participant.nickname),
        ["현하", ...["성민", "수현", "현", "정화"].slice(0, index + 1)],
      );
    }

    const ownerMessages = await ownerApi.getMessages(ownerSession.aiChatSessionId);
    assert.equal(ownerMessages.at(-1)?.content, "'정화'님이 입장했습니다. 모든 참가자가 입장했어요.");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("createMainPageMockApi drives the staged room-create flow without a backend", async () => {
  const api = createMainPageMockApi("room-create");

  const initialSessions = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);
  const initialMessages = await api.getMessages(initialSessions[0].aiChatSessionId);

  assert.equal(initialSessions.length, 1);
  assert.equal(initialMessages.length, 1);

  const startResponse = await api.sendMessage(initialSessions[0].aiChatSessionId, {
    message: "방 만들어줘",
  });

  assert.equal(startResponse.commandResult?.status, "PENDING");
  assert.equal(startResponse.assistantMessage?.content.includes("난이도"), true);
  assert.deepEqual(await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId), []);

  const difficultyResponse = await api.sendMessage(initialSessions[0].aiChatSessionId, {
    message: "쉬운 난이도로 방 만들어줘.",
  });

  assert.equal(difficultyResponse.commandResult?.status, "PENDING");
  assert.equal(
    Array.isArray(difficultyResponse.assistantMessage?.metadata?.templates),
    true,
  );

  const templateResponse = await api.sendMessage(initialSessions[0].aiChatSessionId, {
    message: "기초 산술 연산 템플릿으로 진행할게요.",
  });

  assert.equal(templateResponse.commandResult?.status, "SUCCESS");
  assert.equal(templateResponse.commandResult?.gameRoomId, "mock-room-1");

  const currentRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);
  const waitingParticipants = await api.getRoomParticipants("mock-room-1");

  assert.equal(currentRooms.length, 1);
  assert.equal(currentRooms[0].status, "WAITING");
  assert.deepEqual(waitingParticipants, [
    {
      participantId: "mock-room-owner-participant-1",
      gameRoomId: "mock-room-1",
      gameRoomTitle: "기초 산술 연산 릴레이 방",
      userId: MAIN_PAGE_MOCK_USER.userId,
      nickname: MAIN_PAGE_MOCK_USER.nickname,
      role: "OWNER",
      status: "JOINED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T03:06:00.000Z",
    },
  ]);
});

test("room-create-delay scenario keeps the first room refetch empty so waiting-room transition can be checked", async () => {
  const api = createMainPageMockApi("room-create-delay");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);

  await api.sendMessage(session.aiChatSessionId, {
    message: "방 만들어줘",
  });
  await api.sendMessage(session.aiChatSessionId, {
    message: "보통 난이도로 방 만들어줘.",
  });
  await api.sendMessage(session.aiChatSessionId, {
    message: "배열 필터링 템플릿으로 진행할게요.",
  });

  const firstRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);
  const secondRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);

  assert.deepEqual(firstRooms, []);
  assert.equal(secondRooms.length, 1);
  assert.equal(secondRooms[0].gameRoomId, "mock-room-1");
});

test("mock room-create flow keeps the template step pending until a suggested template is confirmed", async () => {
  const api = createMainPageMockApi("room-create");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);

  await api.sendMessage(session.aiChatSessionId, {
    message: "방 만들어줘",
  });
  await api.sendMessage(session.aiChatSessionId, {
    message: "쉬운 난이도로 방 만들어줘.",
  });

  const invalidTemplateResponse = await api.sendMessage(session.aiChatSessionId, {
    message: "아무 템플릿이나 할게요.",
  });

  assert.equal(invalidTemplateResponse.commandResult?.status, "PENDING");
  assert.equal(
    Array.isArray(invalidTemplateResponse.assistantMessage?.metadata?.templates),
    true,
  );
  assert.deepEqual(await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId), []);
});

test("mock scenario reset restores the initial empty room-create state", async () => {
  const api = createMainPageMockApi("room-create");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);

  await api.sendMessage(session.aiChatSessionId, {
    message: "방 만들어줘",
  });
  api.reset();

  const rooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);
  const messages = await api.getMessages(session.aiChatSessionId);

  assert.deepEqual(rooms, []);
  assert.equal(messages.length, 1);
});

test("invitation mock scenario accepts an invitation and enters waiting-room state", async () => {
  const api = createMainPageMockApi("invitation");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);
  const initialInvitations = await api.getInvitedParticipants(MAIN_PAGE_MOCK_USER.userId);

  assert.equal(initialInvitations.length, 1);

  const response = await api.sendMessage(session.aiChatSessionId, {
    message: "문자열 핸들링 릴레이 방 초대 수락할게요.",
  });

  assert.equal(response.requestType, "ROOM_JOIN");
  assert.equal(response.commandResult?.status, "SUCCESS");
  assert.deepEqual(await api.getInvitedParticipants(MAIN_PAGE_MOCK_USER.userId), []);

  const currentRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);

  assert.equal(currentRooms.length, 1);
  assert.equal(currentRooms[0].myMembershipStatus, "JOINED");
  assert.deepEqual(await api.getRoomParticipants("mock-invitation-room-1"), [
    {
      participantId: "mock-room-owner-participant-2",
      gameRoomId: "mock-invitation-room-1",
      gameRoomTitle: "문자열 핸들링 릴레이 방",
      userId: "mock-owner-1",
      nickname: "목방장",
      role: "OWNER",
      status: "JOINED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T03:06:00.000Z",
    },
    {
      participantId: "mock-room-player-participant-2",
      gameRoomId: "mock-invitation-room-1",
      gameRoomTitle: "문자열 핸들링 릴레이 방",
      userId: MAIN_PAGE_MOCK_USER.userId,
      nickname: MAIN_PAGE_MOCK_USER.nickname,
      role: "PARTICIPANT",
      status: "JOINED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T03:06:00.000Z",
    },
  ]);
});

test("invitation-delay scenario keeps the first joined room refetch empty so waiting-room transition can be checked", async () => {
  const api = createMainPageMockApi("invitation-delay");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);

  await api.sendMessage(session.aiChatSessionId, {
    message: "문자열 핸들링 릴레이 방 초대 수락할게요.",
  });

  const firstRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);
  const secondRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);

  assert.deepEqual(firstRooms, []);
  assert.equal(secondRooms.length, 1);
  assert.equal(secondRooms[0].gameRoomId, "mock-invitation-room-1");
});

test("invitation mock scenario can deny an invitation and remove the card without entering a room", async () => {
  const api = createMainPageMockApi("invitation");
  const [session] = await api.getSessions(MAIN_PAGE_MOCK_USER.userId);

  const response = await api.sendMessage(session.aiChatSessionId, {
    message: "문자열 핸들링 릴레이 방 초대는 거절할게요.",
  });

  assert.equal(response.requestType, "USER_INVITE_DENY");
  assert.equal(response.commandResult?.status, "SUCCESS");
  assert.deepEqual(await api.getInvitedParticipants(MAIN_PAGE_MOCK_USER.userId), []);
  assert.deepEqual(await api.getRoomParticipants("mock-invitation-room-1"), []);
  assert.deepEqual(await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId), []);
});

test("start-ready mock scenario accepts the start request but keeps the user in waiting-room state", async () => {
  const api = createMainPageMockApi("start-ready");
  const currentRooms = await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId);

  assert.equal(currentRooms.length, 1);
  assert.equal(currentRooms[0].gameRoomId, "mock-start-ready-room-1");
  assert.equal(currentRooms[0].status, "WAITING");
  assert.equal(currentRooms[0].joinedParticipantCount, 2);

  const response = await api.startGame("mock-start-ready-room-1");

  assert.deepEqual(response, { success: true });
  assert.deepEqual(await api.getCurrentRooms(MAIN_PAGE_MOCK_USER.userId), currentRooms);
  assert.deepEqual(await api.getRoomParticipants("mock-start-ready-room-1"), [
    {
      participantId: "mock-start-owner-participant-1",
      gameRoomId: "mock-start-ready-room-1",
      gameRoomTitle: "배열 누적합 릴레이 방",
      userId: MAIN_PAGE_MOCK_USER.userId,
      nickname: MAIN_PAGE_MOCK_USER.nickname,
      role: "OWNER",
      status: "JOINED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T03:06:00.000Z",
    },
    {
      participantId: "mock-start-player-participant-1",
      gameRoomId: "mock-start-ready-room-1",
      gameRoomTitle: "배열 누적합 릴레이 방",
      userId: "mock-teammate-1",
      nickname: "목팀원",
      role: "PARTICIPANT",
      status: "JOINED",
      roomStatus: "WAITING",
      createdAt: "2026-05-25T03:06:00.000Z",
    },
  ]);
});
