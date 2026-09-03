/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { createBrowserAuthClient, type BrowserAuthFetch } from "./browser-auth-client";
import { browserCookieSessionCredential } from "./session-credential";

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { "content-type": "application/json" },
  },
);

describe("Better Auth browser client", () => {
  it("delegates Google OAuth and its redirect to Better Auth", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    let requestedCredentials: RequestCredentials | undefined;
    const fetch: BrowserAuthFetch = async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedCredentials = init?.credentials;
      return jsonResponse({
        redirect: false,
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=oauth-state",
      });
    };
    const client = createBrowserAuthClient("https://briar.example", { fetch });

    await client.signInWithGoogle({
      callbackURL: "https://briar.example/app/invitations/example",
      locale: "ko",
    });

    expect(requestedUrl).toBe(
      "https://briar.example/api/auth/sign-in/social",
    );
    expect(requestedBody).toEqual({
      callbackURL: "https://briar.example/app/invitations/example",
      provider: "google",
    });
    expect(requestedCredentials).toBe("include");
  });

  it("uses Better Auth email OTP endpoints", async () => {
    const requests: Array<{
      body: unknown;
      credentials: RequestCredentials | undefined;
      url: string;
    }> = [];
    const fetch: BrowserAuthFetch = async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        credentials: init?.credentials,
        url: String(input),
      });
      if (String(input).endsWith("/email-otp/send-verification-otp")) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({
        token: "server-session-token",
        user: { id: "user-1", email: "person@example.com", name: "person" },
      });
    };
    const client = createBrowserAuthClient("https://briar.example", { fetch });

    await client.sendEmailOTP("person@example.com", "en");
    await client.signInWithEmailOTP({
      email: "person@example.com",
      locale: "en",
      otp: "123456",
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://briar.example/api/auth/email-otp/send-verification-otp",
      "https://briar.example/api/auth/sign-in/email-otp",
    ]);
    expect(requests[0]?.body).toEqual({
      email: "person@example.com",
      type: "sign-in",
    });
    expect(requests[1]?.body).toMatchObject({
      email: "person@example.com",
      name: "person",
      otp: "123456",
    });
    expect(requests.every((request) => request.credentials === "include"))
      .toBe(true);
  });

  it("restores and signs out through Better Auth's cookie session APIs", async () => {
    const requests: Array<{
      credentials: RequestCredentials | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetch: BrowserAuthFetch = async (input, init) => {
      requests.push({
        credentials: init?.credentials,
        method: init?.method,
        url: String(input),
      });
      if (String(input).endsWith("/sign-out")) {
        return jsonResponse({ success: true });
      }
      return jsonResponse({
        session: { id: "session-1" },
        user: { id: "user-1", email: "person@example.com", name: "person" },
      });
    };
    const client = createBrowserAuthClient("https://briar.example", { fetch });

    await expect(client.readSessionCredential()).resolves.toBe(
      browserCookieSessionCredential,
    );
    await expect(client.signOut()).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        credentials: "include",
        method: "GET",
        url: "https://briar.example/api/auth/get-session",
      },
      {
        credentials: "include",
        method: "POST",
        url: "https://briar.example/api/auth/sign-out",
      },
    ]);
  });
});
