import test from "node:test";
import assert from "node:assert/strict";
import {
  getGuestRouteRedirectPath,
  getProtectedRouteRedirectPath,
  getRootRedirectPath,
  shouldBypassProtectedRouteForMainPageMock,
} from "../../src/app/router/authRouting.ts";

test("getRootRedirectPath sends guests to login and members to main", () => {
  assert.equal(getRootRedirectPath(false), "/login");
  assert.equal(getRootRedirectPath(true), "/main");
});

test("getGuestRouteRedirectPath blocks authenticated users from guest-only routes", () => {
  assert.equal(getGuestRouteRedirectPath(false), null);
  assert.equal(getGuestRouteRedirectPath(true), "/main");
});

test("getProtectedRouteRedirectPath blocks guests from protected routes", () => {
  assert.equal(getProtectedRouteRedirectPath(false), "/login");
  assert.equal(getProtectedRouteRedirectPath(true), null);
});

test("shouldBypassProtectedRouteForMainPageMock only allows supported mock scenarios on /main", () => {
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=room-create"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=room-create-delay"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=invitation"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=invitation-delay"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=start-ready"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=presentation-owner"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=presentation-guest"),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/rooms/mock", "?mock=room-create"),
    false,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock(
      "/rooms/presentation-room-1/play",
      "?mock=presentation-owner",
    ),
    true,
  );
  assert.equal(
    shouldBypassProtectedRouteForMainPageMock("/main", "?mock=unknown"),
    false,
  );
});
