export function getRootRedirectPath(isAuthenticated: boolean) {
  return isAuthenticated ? "/main" : "/login";
}

export function getGuestRouteRedirectPath(isAuthenticated: boolean) {
  return isAuthenticated ? "/main" : null;
}

export function getProtectedRouteRedirectPath(isAuthenticated: boolean) {
  return isAuthenticated ? null : "/login";
}

export function shouldBypassProtectedRouteForMainPageMock(
  pathname: string,
  search: string,
) {
  const value = new URLSearchParams(search).get("mock");
  const isMainPage = pathname === "/main";
  const isPresentationGameRoom =
    /^\/rooms\/[^/]+\/play$/.test(pathname) &&
    (value === "presentation-owner" || value === "presentation-guest");

  if (!isMainPage && !isPresentationGameRoom) {
    return false;
  }

  return (
    value === "room-create" ||
    value === "room-create-delay" ||
    value === "invitation" ||
    value === "invitation-delay" ||
    value === "start-ready" ||
    value === "presentation-owner" ||
    value === "presentation-guest"
  );
}
