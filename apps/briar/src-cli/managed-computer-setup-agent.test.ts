import { describe, expect, it } from "vitest";
import {
  authenticationFailureMessage,
  cleanManagedSetupOutput,
  githubSetupChallenge,
  managedComputerProviderAuthCommand,
  OPENCODE_SKIP_SENTINEL,
  providerSetupChallenge,
} from "./managed-computer-setup-agent";

describe("managed computer setup provider adapters", () => {
  it("starts each supported provider with a fixed headless login command", () => {
    expect(managedComputerProviderAuthCommand("codex")).toEqual({
      binary: "codex",
      args: ["login", "--device-auth"],
    });
    expect(managedComputerProviderAuthCommand("claude")).toEqual({
      binary: "claude",
      args: ["auth", "login", "--claudeai"],
    });
    expect(managedComputerProviderAuthCommand("grok")).toEqual({
      binary: "grok",
      args: ["login", "--device-auth"],
    });
    expect(managedComputerProviderAuthCommand("opencode")).toEqual({
      binary: "opencode",
      args: ["auth", "login", "--provider", "opencode", "--pure"],
    });
  });

  it("extracts device URLs and codes without forwarding terminal output", () => {
    expect(githubSetupChallenge(
      "First copy your one-time code: ABCD-EFGH\n" +
        "Open https://github.com/login/device in your browser",
    )).toEqual({
      kind: "device_code",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-EFGH",
    });
    expect(providerSetupChallenge(
      "codex",
      "\u001b[32mOpen https://auth.openai.com/codex/device and enter WXYZ-12345\u001b[0m",
    )).toEqual({
      kind: "device_code",
      verificationUri: "https://auth.openai.com/codex/device",
      userCode: "WXYZ-12345",
    });
    expect(cleanManagedSetupOutput("\u001b[31msecret\u001b[0m")).toBe("secret");
  });

  it("uses returned-code and API-key challenges for Claude and OpenCode", () => {
    expect(providerSetupChallenge(
      "claude",
      "Open https://claude.ai/oauth/authorize?code=true to continue",
    )).toEqual({
      kind: "authorization_code",
      verificationUri: "https://claude.ai/oauth/authorize?code=true",
    });
    expect(providerSetupChallenge("opencode", "")).toEqual({
      kind: "api_key",
      verificationUri: "https://opencode.ai/auth",
    });
  });

  it("classifies safe authentication errors without forwarding command output", () => {
    expect(authenticationFailureMessage(
      "sh: 1: codex: not found\nsecret WXYZ-12345",
    )).toBe("Authentication command is not available on this computer");
    expect(authenticationFailureMessage(
      "Error logging in with device code: Permission denied (os error 13)",
    )).toBe("Authentication credential storage is not writable");
    expect(authenticationFailureMessage("provider secret output")).toBe(
      "Authentication command failed",
    );
  });

  it("exposes a skip sentinel for the opencode provider", () => {
    expect(OPENCODE_SKIP_SENTINEL).toBe("SKIP");
  });
});
