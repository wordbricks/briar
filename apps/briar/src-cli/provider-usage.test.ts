import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeTokenState,
  jwtEmail,
  parseClaudeAccountCredentials,
  parseGeminiOauthAccess,
  parseGrokAuthSession,
  parseOpencodeAuthLabel,
  parseOpencodeGoKey,
} from "./provider-credentials";
import {
  claudeUsageErrorForStatus,
  loadOpenrouterUsage,
  loadProviderUsage,
  opencodeUsageErrorForStatus,
  parseAgyCliQuota,
  parseAgyQuota,
  parseClaudeUsageResponse,
  parseCliResetTime,
  parseCodexRateLimits,
  parseGrokBilling,
  parseOpencodeUsageResponse,
  providerUsageProbe,
  type ProviderUsageResult,
} from "./provider-usage";

const usageOf = (result: ProviderUsageResult) => {
  expect(result.error).toBeNull();
  return result.usage!;
};

const probeOf = (result: ProviderUsageResult) =>
  providerUsageProbe(usageOf(result));

describe("provider usage probes", () => {
  it("reflects the OpenRouter credential status without quota windows", () => {
    const configured = loadOpenrouterUsage(true);
    expect(configured.status).toBe("ok");
    expect(configured.authenticated).toBe(true);
    expect(configured.session).toBeNull();
    expect(configured.weekly).toBeNull();
    expect(configured.monthly).toBeNull();
    expect(configured.error).toBeNull();

    const missing = loadOpenrouterUsage(false);
    expect(missing.status).toBe("unavailable");
    expect(missing.authenticated).toBe(false);
    expect(missing.error).toBe("OpenRouter API 키가 필요합니다.");
  });

  it("maps Codex rate-limit windows, plan and exhaustion", () => {
    const ok = parseCodexRateLimits({
      id: 2,
      result: {
        rateLimits: {
          primary: {
            usedPercent: 81,
            windowDurationMins: 10_080,
            resetsAt: 1_800_000_000,
          },
          secondary: {
            usedPercent: 37.5,
            windowDurationMins: 300,
            resetsAt: 1_800_086_400,
          },
          planType: "plus",
        },
      },
    });
    const usage = usageOf(ok);
    expect(usage.status).toBe("ok");
    expect(usage.session?.usedPercent).toBe(37.5);
    expect(usage.weekly?.windowMinutes).toBe(10_080);
    expect(usage.weekly?.resetsAt).toBe(1_800_000_000_000);
    expect(usage.planType).toBe("plus");
    expect(probeOf(ok)).toMatchObject({ exhausted: false, maxUsedPercent: 81 });

    const exhausted = parseCodexRateLimits({
      id: 2,
      result: {
        rateLimits: {
          primary: { usedPercent: 100, windowDurationMins: 10_080 },
          secondary: { usedPercent: 12, windowDurationMins: 300 },
        },
      },
    });
    expect(probeOf(exhausted)).toMatchObject({
      exhausted: true,
      maxUsedPercent: 100,
    });
  });

  it("reports a Codex account without usage instead of a parse failure", () => {
    expect(parseCodexRateLimits({ id: 2, result: {} }).error).toBe(
      "Codex 계정에 usage 정보가 없습니다. 로그인 상태를 확인하세요.",
    );
    expect(
      parseCodexRateLimits({ id: 2, error: { message: "boom" } }).error,
    ).toBe("boom");
  });

  it("clamps Claude percentages and normalizes epoch units", () => {
    const result = parseClaudeUsageResponse({
      five_hour: { utilization: 104, resets_at: "1800000000" },
      seven_day: { utilization: 100 },
    });
    const usage = usageOf(result);
    expect(usage.session?.usedPercent).toBe(100);
    expect(usage.session?.resetsAt).toBe(1_800_000_000_000);
    expect(probeOf(result)).toMatchObject({
      exhausted: true,
      maxUsedPercent: 100,
    });
    expect(parseClaudeUsageResponse({}).error).toBe(
      "Claude 계정에 usage 정보가 없습니다.",
    );
  });

  it("separates a stale Claude access token from an expired login", () => {
    const now = 1_800_000_000_000;
    const stored = (oauth: Record<string, unknown>) =>
      parseClaudeAccountCredentials(JSON.stringify({ claudeAiOauth: oauth }))!;

    expect(
      claudeTokenState(
        stored({ accessToken: "secret", expiresAt: now + 3_600_000 }),
        now,
      ),
    ).toBe("usable");
    expect(
      claudeTokenState(
        stored({ accessToken: "secret", refreshToken: "refresh" }),
        now,
      ),
    ).toBe("usable");
    expect(
      claudeTokenState(
        stored({
          accessToken: "secret",
          refreshToken: "refresh",
          expiresAt: now - 1_000,
        }),
        now,
      ),
    ).toBe("stale");
    expect(
      claudeTokenState(
        stored({ accessToken: "secret", expiresAt: now - 1_000 }),
        now,
      ),
    ).toBe("expired");
    expect(
      claudeTokenState(
        stored({
          accessToken: "secret",
          refreshToken: "refresh",
          expiresAt: now - 1_000,
          refreshTokenExpiresAt: now - 1_000,
        }),
        now,
      ),
    ).toBe("expired");
  });

  it("asks for reauthentication only when Claude rejects the token", () => {
    const rejected = claudeUsageErrorForStatus(401);
    expect(rejected.reauthenticationRequired).toBe(true);
    expect(rejected.message).not.toContain("로그인이 만료");

    expect(claudeUsageErrorForStatus(429).reauthenticationRequired).toBe(false);
    const serverError = claudeUsageErrorForStatus(500);
    expect(serverError.reauthenticationRequired).toBe(false);
    expect(serverError.message).toContain("HTTP 500");
  });

  it("reads provider account labels from auth metadata", () => {
    const credentials = parseClaudeAccountCredentials(
      '{"claudeAiOauth":{"accessToken":"secret","emailAddress":"dev@example.com","subscriptionType":"max"}}',
    );
    expect(credentials?.accessToken).toBe("secret");
    expect(credentials?.accountLabel).toBe("dev@example.com");
    expect(credentials?.planType).toBe("max");

    const payload = Buffer.from('{"email":"codex@example.com"}').toString(
      "base64url",
    );
    expect(jwtEmail(`header.${payload}.signature`)).toBe("codex@example.com");
    expect(
      parseOpencodeAuthLabel(
        '{"google":{"type":"oauth","email":"agy@example.com"}}',
      ),
    ).toBe("agy@example.com");
  });

  it("prefers a fresh x.ai Grok session", () => {
    const session = parseGrokAuthSession(
      JSON.stringify({
        "https://alternate.example.com::client": {
          key: "stale-token",
          user_id: "stale-user",
        },
        "https://auth.x.ai::client": {
          key: "live-token",
          user_id: "live-user",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
      Date.now(),
    );
    expect(session?.accessToken).toBe("live-token");
    expect(session?.userId).toBe("live-user");
    expect(session?.accountLabel).toBeNull();
  });

  it("maps Grok weekly, confirmed-zero and monthly usage", () => {
    const weekly = parseGrokBilling(
      {
        config: {
          creditUsagePercent: 100,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            end: "2026-08-17T00:00:00Z",
          },
        },
      },
      "weekly",
    );
    expect(weekly?.usedPercent).toBe(100);

    const confirmedZero = parseGrokBilling(
      {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-17T19:38:56Z",
          end: "2026-07-24T19:38:56Z",
        },
        billingPeriodStart: "2026-07-17T19:38:56+00:00",
        billingPeriodEnd: "2026-07-24T19:38:56+00:00",
      },
      "weekly",
    );
    expect(confirmedZero?.usedPercent).toBe(0);
    expect(confirmedZero?.windowMinutes).toBe(10_080);
    expect(confirmedZero?.resetsAt).toBe(Date.parse("2026-07-24T19:38:56Z"));

    const monthly = parseGrokBilling(
      {
        monthlyLimit: { val: "150000" },
        used: { val: 75_000 },
        billingPeriodEnd: "2026-08-01T00:00:00Z",
      },
      "monthly",
    );
    expect(monthly?.usedPercent).toBe(50);
    expect(monthly?.windowMinutes).toBe(43_200);
    expect(parseGrokBilling({}, "weekly")).toBeNull();
  });

  it("maps Antigravity API buckets to the tightest window", () => {
    const result = parseAgyQuota({
      buckets: [
        {
          remainingFraction: 0.8,
          resetTime: "2026-08-18T12:00:00Z",
          modelId: "gemini-3.1-flash",
        },
        {
          remainingFraction: 0.25,
          resetTime: "2026-08-18T11:00:00Z",
          modelId: "gemini-3.1-pro",
        },
      ],
    });
    const usage = usageOf(result);
    expect(usage.status).toBe("ok");
    expect(usage.session?.usedPercent).toBe(75);
    expect(usage.session?.windowMinutes).toBe(60);
    expect(usage.session?.resetsAt).toBe(Date.parse("2026-08-18T11:00:00Z"));
    expect(
      probeOf(parseAgyQuota({ buckets: [{ remainingFraction: 0 }] })).exhausted,
    ).toBe(true);
  });

  it("ignores an expired Antigravity OAuth access token", () => {
    const now = Date.now();
    expect(
      parseGeminiOauthAccess('{"access_token":"secret","expiry_date":1}', now),
    ).toBeNull();
    expect(
      parseGeminiOauthAccess(
        '{"access_token":"secret","expiry_date":4102444800000}',
        now,
      )?.accessToken,
    ).toBe("secret");
  });

  it("parses the Antigravity CLI quota payload", () => {
    const usage = usageOf(
      parseAgyCliQuota({
        command: {
          name: "usage",
          data: {
            description: "Current quota usage",
            groups: [
              {
                name: "Gemini Models",
                buckets: [
                  {
                    window: "weekly",
                    remaining_fraction: 0.6,
                    reset_time: "2026-08-25T12:00:00Z",
                  },
                  {
                    window: "5h",
                    remaining_fraction: 0.1,
                    reset_time: "2026-08-19T12:00:00Z",
                  },
                ],
              },
              { name: "Claude and GPT models", buckets: [] },
            ],
          },
        },
      }),
    );
    expect(usage.session?.windowMinutes).toBe(300);
    expect(usage.session?.usedPercent).toBeCloseTo(90, 4);
    expect(usage.session?.resetsAt).toBe(Date.parse("2026-08-19T12:00:00Z"));
    expect(usage.weekly?.windowMinutes).toBe(10_080);
    expect(usage.weekly?.usedPercent).toBeCloseTo(40, 4);
  });

  it("rejects malformed Antigravity CLI quota payloads", () => {
    expect(
      parseAgyCliQuota({
        command: {
          name: "usage",
          data: {
            groups: [
              {
                name: "Claude and GPT models",
                buckets: [{ window: "weekly", remaining_fraction: 0.5 }],
              },
            ],
          },
        },
      }).error,
    ).toBe("quota에서 Gemini Models 그룹을 찾을 수 없습니다.");
    expect(
      parseAgyCliQuota({ command: { name: "not-usage", data: { groups: [] } } })
        .error,
    ).toContain("올바르지 않은 command name입니다");

    const malformed = usageOf(
      parseAgyCliQuota({
        command: {
          name: "usage",
          data: {
            groups: [
              {
                name: "Gemini Models",
                buckets: [{ window: "weekly" }, { remaining_fraction: 0.25 }],
              },
            ],
          },
        },
      }),
    );
    expect(malformed.session).toBeNull();
    expect(malformed.weekly).toBeNull();
  });

  it("reads Antigravity reset times as ISO or epoch values", () => {
    expect(parseCliResetTime("2026-08-18T12:00:00Z")).toBe(
      Date.parse("2026-08-18T12:00:00Z"),
    );
    expect(parseCliResetTime(1_800_000_000)).toBe(1_800_000_000_000);
    expect(parseCliResetTime("1800000000")).toBe(1_800_000_000_000);
    expect(parseCliResetTime("not-a-date")).toBeNull();
  });

  it("maps OpenCode Go windows to the shared quota shape", () => {
    const result = parseOpencodeUsageResponse({
      usage: {
        rolling: { status: "rate-limited", percent: 104, resetsAt: "2026-09-04T13:50:47Z" },
        weekly: { status: "ok", percent: 12.5, resetsAt: "2026-09-07T00:00:00Z" },
        monthly: { status: "ok", percent: 0, resetsAt: "2026-10-04T08:48:47Z" },
      },
    });
    const usage = usageOf(result);
    expect(usage.status).toBe("ok");
    expect(usage.session?.windowMinutes).toBe(300);
    expect(usage.session?.usedPercent).toBe(100);
    expect(usage.session?.resetsAt).toBe(Date.parse("2026-09-04T13:50:47Z"));
    expect(usage.weekly?.windowMinutes).toBe(10_080);
    expect(usage.weekly?.usedPercent).toBe(12.5);
    expect(usage.monthly?.windowMinutes).toBe(43_200);
    expect(usage.monthly?.usedPercent).toBe(0);
    expect(probeOf(result)).toMatchObject({ exhausted: true, maxUsedPercent: 100 });

    expect(parseOpencodeUsageResponse({}).error).toBe(
      "OpenCode usage 응답을 읽지 못했습니다.",
    );
    expect(parseOpencodeUsageResponse({ usage: {} }).error).toBe(
      "OpenCode 계정에 usage 정보가 없습니다.",
    );
  });

  it("reads the OpenCode Go key from auth.json only", () => {
    expect(
      parseOpencodeGoKey('{"opencode-go":{"type":"api","key":" go-secret "}}'),
    ).toBe("go-secret");
    expect(parseOpencodeGoKey('{"google":{"type":"oauth","key":"x"}}')).toBeNull();
    expect(parseOpencodeGoKey("not-json")).toBeNull();
    expect(
      parseOpencodeGoKey('{"opencode-go":{"type":"api","key":"   "}}'),
    ).toBeNull();
  });

  it("flags reauthentication only when OpenCode rejects the Go key", () => {
    expect(opencodeUsageErrorForStatus(401).reauthenticationRequired).toBe(true);
    expect(opencodeUsageErrorForStatus(403).message).toContain("opencode auth login");
    expect(opencodeUsageErrorForStatus(500).reauthenticationRequired).toBe(false);
    expect(opencodeUsageErrorForStatus(500).message).toContain("HTTP 500");
  });
});

describe("OpenCode usage over the Go API", () => {
  const usagePayload = {
    usage: {
      rolling: { status: "ok", percent: 1, resetsAt: "2026-09-04T13:50:47Z" },
      weekly: { status: "ok", percent: 0, resetsAt: "2026-09-07T00:00:00Z" },
      monthly: { status: "ok", percent: 0, resetsAt: "2026-10-04T08:48:47Z" },
    },
  };

  const withMockOpencode = async (
    auth: string,
    response: Response | Error,
    run: (
      home: string,
      requests: RequestInfo[],
      fetchImpl: typeof fetch,
    ) => Promise<void>,
  ) => {
    const home = await mkdtemp(join(tmpdir(), "briar-opencode-usage-"));
    const requests: RequestInfo[] = [];
    try {
      await mkdir(
        join(home, ".local", "share", "opencode"),
        { recursive: true },
      );
      await writeFile(
        join(home, ".local", "share", "opencode", "auth.json"),
        auth,
      );
      const fetchImpl = Object.assign(
        (input: RequestInfo) => {
          requests.push(input);
          return response instanceof Error
            ? Promise.reject(response)
            : Promise.resolve(response);
        },
        { preconnect: () => undefined },
      ) as unknown as typeof fetch;
      await run(home, requests, fetchImpl);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };

  it("reports Go usage windows for an account with a Go key", async () => {
    await withMockOpencode(
      '{"opencode-go":{"type":"api","key":"go-secret"}}',
      Response.json(usagePayload),
      async (home, requests, fetchImpl) => {
        const usage = await loadProviderUsage("opencode", {
          home,
          which: () => "/usr/local/bin/opencode",
          fetchImpl,
        });
        expect(usage.status).toBe("ok");
        expect(usage.authenticated).toBe(true);
        expect(usage.session?.windowMinutes).toBe(300);
        expect(usage.session?.usedPercent).toBe(1);
        expect(usage.weekly?.usedPercent).toBe(0);
        expect(usage.monthly?.windowMinutes).toBe(43_200);
        expect(usage.error).toBeNull();
        expect(requests).toHaveLength(1);
        expect(String(requests[0])).toBe("https://opencode.ai/zen/go/v1/usage");
      },
    );
  });

  it("keeps a Go-keyless account connected without windows", async () => {
    await withMockOpencode(
      '{"google":{"type":"oauth","email":"agy@example.com"}}',
      Response.json(usagePayload),
      async (home, requests, fetchImpl) => {
        const usage = await loadProviderUsage("opencode", {
          home,
          which: () => "/usr/local/bin/opencode",
          fetchImpl,
        });
        expect(usage.status).toBe("ok");
        expect(usage.authenticated).toBe(true);
        expect(usage.accountLabel).toBe("agy@example.com");
        expect(usage.session).toBeNull();
        expect(usage.weekly).toBeNull();
        expect(usage.monthly).toBeNull();
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("asks for a fresh login when the Go key is rejected", async () => {
    await withMockOpencode(
      '{"opencode-go":{"type":"api","key":"revoked"}}',
      new Response(null, { status: 401 }),
      async (home, _requests, fetchImpl) => {
        const usage = await loadProviderUsage("opencode", {
          home,
          which: () => "/usr/local/bin/opencode",
          fetchImpl,
        });
        expect(usage.status).toBe("error");
        expect(usage.authenticated).toBe(false);
        expect(usage.reauthenticationRequired).toBe(true);
        expect(usage.error).toContain("다시 로그인하세요");
      },
    );
  });

  it("reports network failures without dropping the account", async () => {
    await withMockOpencode(
      '{"opencode-go":{"type":"api","key":"go-secret"}}',
      new Error("offline"),
      async (home, _requests, fetchImpl) => {
        const usage = await loadProviderUsage("opencode", {
          home,
          which: () => "/usr/local/bin/opencode",
          fetchImpl,
        });
        expect(usage.status).toBe("error");
        expect(usage.authenticated).toBe(true);
        expect(usage.reauthenticationRequired).toBe(false);
        expect(usage.error).toContain("offline");
      },
    );
  });

  it("reports a missing OpenCode login the way the app always has", async () => {
    const usage = await loadProviderUsage("opencode", {
      home: "/nonexistent",
      which: () => null,
    });
    expect(usage.status).toBe("unavailable");
    expect(usage.error).toBe("OpenCode CLI가 필요합니다.");
  });
});

describe("Antigravity usage over the installed CLI", () => {
  const quotaPayload = JSON.stringify({
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            buckets: [
              {
                window: "5h",
                remaining_fraction: 0.5,
                reset_time: "2026-08-18T12:00:00Z",
              },
            ],
          },
        ],
      },
    },
  });

  const withMockAgy = async (
    script: string,
    run: (home: string, binary: string) => Promise<void>,
  ) => {
    const home = await mkdtemp(join(tmpdir(), "briar-agy-usage-"));
    try {
      const binary = join(home, "agy");
      await writeFile(binary, script, { mode: 0o755 });
      await run(home, binary);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };

  const writeGeminiCredentials = async (
    home: string,
    credentials: Record<string, unknown>,
  ) => {
    await mkdir(join(home, ".gemini"), { recursive: true });
    await writeFile(
      join(home, ".gemini", "oauth_creds.json"),
      JSON.stringify(credentials),
    );
  };

  it("reads quota from the CLI when it is signed in", async () => {
    await withMockAgy(
      `#!/bin/sh\nprintf '%s' '${quotaPayload}'\nexit 0\n`,
      async (home, binary) => {
        await writeGeminiCredentials(home, { email: "user@example.com" });
        const usage = await loadProviderUsage("agy", {
          home,
          which: () => binary,
        });
        expect(usage.status).toBe("ok");
        expect(usage.authenticated).toBe(true);
        expect(usage.accountLabel).toBe("user@example.com");
        expect(usage.session?.windowMinutes).toBe(300);
        expect(usage.session?.usedPercent).toBe(50);
      },
    );
  });

  it("keeps the account connected when the CLI quota command fails", async () => {
    // `models` succeeds, so the CLI is signed in, but `/quota` exits non-zero.
    const script =
      '#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "models" ]; then exit 0; fi\ndone\necho "some error" >&2\nexit 1\n';
    await withMockAgy(script, async (home, binary) => {
      await writeGeminiCredentials(home, {
        access_token: "expired-token",
        expiry_date: 1,
        email: "user@example.com",
      });
      const usage = await loadProviderUsage("agy", {
        home,
        which: () => binary,
      });
      expect(usage.status).toBe("error");
      expect(usage.authenticated).toBe(true);
      expect(usage.accountLabel).toBe("user@example.com");
      expect(usage.error).toContain("CLI 오류");
      expect(usage.error).toContain("exit code");
    });

    await withMockAgy(script, async (home, binary) => {
      await writeGeminiCredentials(home, {
        access_token: "live-token",
        expiry_date: Date.now() + 1_000_000,
        email: "fallback@example.com",
      });
      const usage = await loadProviderUsage("agy", {
        home,
        which: () => binary,
        fetchImpl: Object.assign(() => Promise.reject(new Error("offline")), {
          preconnect: () => undefined,
        }),
      });
      expect(usage.status).toBe("error");
      expect(usage.authenticated).toBe(true);
      expect(usage.accountLabel).toBe("fallback@example.com");
      expect(usage.error).toContain("CLI 오류");
      expect(usage.error).toContain("API 오류");
    });
  });

  it("reports a missing Antigravity CLI the way the app always has", async () => {
    const usage = await loadProviderUsage("agy", {
      home: "/nonexistent",
      which: () => null,
    });
    expect(usage.status).toBe("unavailable");
    expect(usage.error).toContain("Google Antigravity CLI가 필요합니다");
  });
});
