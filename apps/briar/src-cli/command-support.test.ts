import { describe, expect, it, vi } from "vitest";
import { type Config } from "./config-contract";
import {
  login,
  openBrowser,
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
  },
  appSettings: {
    preventSleepWhileRunning: false,
    browserAutomationProvider: "ego-browser",
  },
  projects: [],
});

const loginDependencies = (
  openVerificationPage: (url: string) => void,
) => {
  const requestedPaths: string[] = [];
  const request = (async <T>(
    _apiUrl: string,
    path: string,
  ): Promise<T> => {
    requestedPaths.push(path);
    if (path === "/api/auth/device/code") {
      return {
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://briar.example/device",
        verification_uri_complete: "https://briar.example/device?code=ABCD-1234",
        interval: 0,
      } as T;
    }
    if (path === "/api/auth/device/token") {
      return { access_token: "access-token" } as T;
    }
    if (path === "/me") {
      return {
        user: { name: "Jay Nam", email: "jay@example.com" },
      } as T;
    }
    throw new Error(`Unexpected request: ${path}`);
  }) as LoginDependencies["request"];
  const saveConfig = vi.fn(async () => undefined);
  const writeLine = vi.fn();

  return {
    dependencies: {
      loadConfig: async () => config(),
      openBrowser: openVerificationPage,
      request,
      saveConfig,
      sleep: async () => undefined,
      writeLine,
    } satisfies LoginDependencies,
    requestedPaths,
    saveConfig,
    writeLine,
  };
};

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
  it("polls immediately even when the browser opener never exits", async () => {
    const unref = vi.fn();
    const launch = vi.fn(() => ({
      exited: new Promise<number | null>(() => undefined),
      unref,
    }));
    const state = loginDependencies((url) => {
      openBrowser(url, { launch, platform: "linux" });
    });

    await login(undefined, state.dependencies);

    expect(state.requestedPaths).toEqual([
      "/api/auth/device/code",
      "/api/auth/device/token",
      "/me",
    ]);
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
    expect(state.requestedPaths).toContain("/api/auth/device/token");
    expect(state.saveConfig).toHaveBeenCalledOnce();
  });
});
