import { describe, expect, it } from "vitest";
import {
  authorizationStrategy,
  iosAuthorizationInvocation,
} from "./auth-session";

describe("mobile authorization boundary", () => {
  it("uses the iOS auth session with the fixed callback contract", () => {
    expect(authorizationStrategy({
      companionMode: true,
      mobilePlatform: "ios",
      tauri: true,
      androidBridge: false,
    })).toBe("ios_auth_session");
    expect(iosAuthorizationInvocation("https://example.com/sign-in")).toEqual({
      command: "plugin:auth-session|start",
      payload: {
        authUrl: "https://example.com/sign-in",
        callbackUrlScheme: "briar-companion",
        ephemeral: false,
      },
    });
  });

  it("keeps Android authorization inside the installed bridge", () => {
    expect(authorizationStrategy({
      companionMode: true,
      mobilePlatform: "android",
      tauri: false,
      androidBridge: true,
    })).toBe("android_bridge");
    expect(authorizationStrategy({
      companionMode: true,
      mobilePlatform: "android",
      tauri: false,
      androidBridge: false,
    })).toBe("external");
  });
});
