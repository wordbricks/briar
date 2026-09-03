import { describe, expect, it } from "vitest";
import {
  browserCookieSessionCredential,
  withSessionCredential,
} from "./session-credential";

describe("session request credentials", () => {
  it("uses a bearer header for installed app sessions", () => {
    const init = withSessionCredential("session-token", {
      headers: { Accept: "application/json" },
    });

    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer session-token",
    );
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.credentials).toBeUndefined();
  });

  it("uses the browser cookie without exposing a bearer token", () => {
    const init = withSessionCredential(browserCookieSessionCredential, {
      headers: { Accept: "application/json" },
    });

    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.credentials).toBe("include");
  });
});
