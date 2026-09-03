export const browserCookieSessionCredential = "briar:browser-cookie-session";

export const isBrowserCookieSessionCredential = (credential: string) =>
  credential === browserCookieSessionCredential;

export const withSessionCredential = (
  credential: string,
  init: RequestInit = {},
): RequestInit => {
  const headers = new Headers(init.headers);
  if (isBrowserCookieSessionCredential(credential)) {
    return { ...init, credentials: "include", headers };
  }
  headers.set("Authorization", `Bearer ${credential}`);
  return { ...init, headers };
};
