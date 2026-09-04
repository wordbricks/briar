import { describe, expect, it } from "vitest";
import type {
  ManagedComputerSetupToController,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";
import type { ManagedComputerSetupCommandRunner } from "./managed-computer-setup-agent";
import {
  authenticationFailureMessage,
  cleanManagedSetupOutput,
  githubSetupChallenge,
  managedComputerProviderAuthCommand,
  OPENCODE_SKIP_SENTINEL,
  providerSetupChallenge,
  runAuthentication,
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

describe("managed computer setup credential submission", () => {
  function fakeCommandRunner() {
    const writes: string[] = [];
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    let killed = false;
    const commandRunner: ManagedComputerSetupCommandRunner = () => ({
      exited,
      write: (value) => {
        writes.push(value);
        resolveExit(0);
      },
      kill: () => {
        killed = true;
        resolveExit(0);
      },
    });
    return {
      commandRunner,
      writes,
      wasKilled: () => killed,
    };
  }

  it("submits an OpenCode API key with a carriage return so the pty prompt accepts it", async () => {
    const runner = fakeCommandRunner();
    const emitted: ManagedComputerSetupToController[] = [];
    await runAuthentication({
      service: "provider",
      provider: "opencode",
      command: managedComputerProviderAuthCommand("opencode"),
      challengeId: "opencode-auth",
      signal: new AbortController().signal,
    }, {
      commandRunner: runner.commandRunner,
      emit: (message) => emitted.push(message),
      input: async () => "opencode-api-key",
    });
    expect(runner.writes).toEqual(["opencode-api-key\r"]);
    expect(runner.writes[0]!.endsWith("\r")).toBe(true);
    expect(runner.writes[0]!.includes("\n")).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it("short-circuits on the skip sentinel without writing to the prompt", async () => {
    const runner = fakeCommandRunner();
    await expect(runAuthentication({
      service: "provider",
      provider: "opencode",
      command: managedComputerProviderAuthCommand("opencode"),
      challengeId: "opencode-auth",
      signal: new AbortController().signal,
    }, {
      commandRunner: runner.commandRunner,
      emit: () => {},
      input: async () => OPENCODE_SKIP_SENTINEL,
    })).rejects.toThrow("Provider authentication was skipped");
    expect(runner.writes).toEqual([]);
    expect(runner.wasKilled()).toBe(true);
  });
});
