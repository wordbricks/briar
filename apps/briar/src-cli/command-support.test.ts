import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeviceTokenPollResult,
} from "../src/lib/device-authorization-client";
import { type Config } from "./config-contract";
import {
  login,
  openBrowser,
  providerExecutionEnvironment,
  type LoginDependencies,
} from "./command-support";

const config = (): Config => ({
  apiUrl: "https://briar.example",
  agentProviders: {
    codex: true,
    claude: true,
    cursor: true,
    grok: true,
    agy: true,
    opencode: true,
    openrouter: true,
    vertex: true,
    pi: true,
  },
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider: "ego-browser",
  },
  teams: [],
});

const loginDependencies = (
  openVerificationPage: (url: string) => void,
  pollResults: readonly DeviceTokenPollResult[] = [{
    status: "authorized",
    accessToken: "access-token",
    tokenType: "Bearer",
    expiresIn: 3_600,
    scope: "openid profile email",
  }],
) => {
  const requestedOperations: string[] = [];
  let pollIndex = 0;
  const saveConfig = vi.fn(async () => undefined);
  const sleep = vi.fn(async () => undefined);
  const writeLine = vi.fn();

  return {
    dependencies: {
      createDeviceAuthorizationClient: () => ({
        requestCode: async () => {
          requestedOperations.push("requestCode");
          return {
            deviceCode: "device-code",
            userCode: "ABCD-1234",
            verificationUri: "https://briar.example/device",
            verificationUriComplete:
              "https://briar.example/device?code=ABCD-1234",
            expiresIn: 300,
            interval: 1,
          };
        },
        pollToken: async () => {
          requestedOperations.push("pollToken");
          const result = pollResults[pollIndex++];
          if (!result) throw new Error("Unexpected device token poll");
          return result;
        },
      }),
      fetchCurrentUser: async () => ({
        $typeName: "briar.app.v1.User",
        id: "user-id",
        name: "Jay Nam",
        email: "jay@example.com",
      }),
      loadConfig: async () => config(),
      openBrowser: openVerificationPage,
      saveConfig,
      sleep,
      writeLine,
    } satisfies LoginDependencies,
    requestedOperations,
    saveConfig,
    sleep,
    writeLine,
  };
};

const browserConfig = (
  provider: Config["appSettings"]["browserAutomationProvider"],
): Config => ({
  ...config(),
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider: provider,
  },
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("providerExecutionEnvironment", () => {
  it("shares the agent-browser state file only when agent-browser is selected", () => {
    vi.stubEnv("BRIAR_AGENT_BROWSER_STATE_FILE", "");
    vi.stubEnv("BRIAR_WORKTREE_HOME", "/Users/agent");

    const shared = providerExecutionEnvironment(
      browserConfig("agent-browser"),
      "claude",
      {},
    );
    expect(shared.BRIAR_BROWSER_AUTOMATION_PROVIDER).toBe("agent-browser");
    expect(shared.BRIAR_AGENT_BROWSER_STATE_FILE).toBe(
      "/Users/agent/.local/share/briar/agent-browser/shared-state.json",
    );

    for (const provider of ["ego-browser", "aside"] as const) {
      const environment = providerExecutionEnvironment(
        browserConfig(provider),
        "claude",
        {},
      );
      expect(environment.BRIAR_BROWSER_AUTOMATION_PROVIDER).toBe(provider);
      expect(environment.BRIAR_AGENT_BROWSER_STATE_FILE).toBeUndefined();
    }
  });

  it("keeps the state file path Briar already resolved for this run", () => {
    vi.stubEnv("BRIAR_AGENT_BROWSER_STATE_FILE", "");
    vi.stubEnv("BRIAR_WORKTREE_HOME", "/Users/agent");

    const environment = providerExecutionEnvironment(
      browserConfig("agent-browser"),
      "claude",
      { BRIAR_AGENT_BROWSER_STATE_FILE: "/Users/real/state.json" },
    );

    expect(environment.BRIAR_AGENT_BROWSER_STATE_FILE).toBe(
      "/Users/real/state.json",
    );
  });
});

describe("openBrowser", () => {
  it.each([
    ["darwin", "open", ["https://briar.example/device"]],
    ["win32", "cmd", ["/c", "start", "", "https://briar.example/device"]],
    ["linux", "xdg-open", ["https://briar.example/device"]],
  ] as const)(
    "launches detached and suppresses output on %s",
    (operatingSystem, expectedCommand, expectedArguments) => {
      const unref = vi.fn();
      const launch = vi.fn(() => ({
        exited: Promise.resolve(0),
        unref,
      }));

      openBrowser("https://briar.example/device", {
        launch,
        platform: operatingSystem,
      });

      expect(launch).toHaveBeenCalledWith(
        expectedCommand,
        expectedArguments,
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      expect(unref).toHaveBeenCalledOnce();
    },
  );
});

describe("login browser launch", () => {
  it("uses structured pending and slow-down states without waiting for the browser", async () => {
    const unref = vi.fn();
    const launch = vi.fn(() => ({
      exited: new Promise<number | null>(() => undefined),
      unref,
    }));
    const state = loginDependencies(
      (url) => openBrowser(url, { launch, platform: "linux" }),
      [{
        status: "authorization_pending",
        description: "not encoded in an English message",
      }, {
        status: "slow_down",
        description: "rate limited",
      }, {
        status: "authorized",
        accessToken: "access-token",
        tokenType: "Bearer",
        expiresIn: 3_600,
        scope: "openid profile email",
      }],
    );

    await login(undefined, state.dependencies);

    expect(state.requestedOperations).toEqual([
      "requestCode",
      "pollToken",
      "pollToken",
      "pollToken",
    ]);
    expect(state.sleep.mock.calls).toEqual([[1_000], [1_000], [6_000]]);
    expect(unref).toHaveBeenCalledOnce();
    expect(state.saveConfig).toHaveBeenCalledOnce();
  });

  it("prints a fallback URL and still polls when browser launch fails", async () => {
    const browserOutput = vi.fn();
    const state = loginDependencies((url) => {
      openBrowser(url, {
        launch: () => {
          throw new Error("opener unavailable");
        },
        platform: "linux",
        writeLine: browserOutput,
      });
    });

    await login(undefined, state.dependencies);

    expect(browserOutput).toHaveBeenCalledWith(
      "브라우저를 자동으로 열지 못했습니다. 다음 주소를 직접 여세요: " +
        "https://briar.example/device?code=ABCD-1234",
    );
    expect(state.requestedOperations).toContain("pollToken");
    expect(state.saveConfig).toHaveBeenCalledOnce();
  });
});
