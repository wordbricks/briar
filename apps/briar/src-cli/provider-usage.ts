import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import {
  agentProviderBinaryName,
  agentProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import { isProviderUsageExhausted } from "../src/lib/agent-usage";
import {
  agyAuthenticated,
  claudeTokenState,
  epochToMillis,
  GROK_TOKEN_SKEW_MILLIS,
  parseIsoMillis,
  readClaudeCredentials,
  readCodexAccountIdentity,
  readCursorAccountIdentity,
  readGeminiOauthAccess,
  readGeminiOauthEmail,
  readGrokAuthSession,
  readOpencodeAccountIdentity,
  readOpencodeGoKey,
  type GrokAuthSession,
} from "./provider-credentials";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const AGY_LOAD_ASSIST_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const AGY_QUOTA_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GROK_DEFAULT_PROXY_BASE = "https://cli-chat-proxy.grok.com/v1";
const GROK_WEEKLY_MINUTES = 10_080;
const GROK_MONTHLY_MINUTES = 43_200;
const OPENCODE_ROLLING_MINUTES = 300;
const OPENCODE_WEEKLY_MINUTES = 10_080;
const OPENCODE_MONTHLY_MINUTES = 43_200;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** Missing-binary copy the desktop app has always shown for each provider. */
export const providerMissingBinaryMessage = {
  codex: "Codex CLI가 필요합니다. Codex를 설치하고 로그인한 뒤 Briar를 다시 여세요.",
  claude:
    "Claude Code가 필요합니다. Claude를 설치하고 `claude auth login`을 실행한 뒤 다시 시도하세요.",
  cursor:
    "Cursor CLI가 필요합니다. Cursor CLI를 설치하고 `agent login`을 실행한 뒤 다시 시도하세요.",
  grok: "Grok CLI가 필요합니다. Grok을 설치하고 `grok login`을 실행한 뒤 다시 시도하세요.",
  agy: "Google Antigravity CLI가 필요합니다. `agy`를 설치하고 로그인한 뒤 다시 시도하세요.",
  opencode:
    "OpenCode CLI가 필요합니다. OpenCode를 설치하고 `opencode auth login`을 실행한 뒤 다시 시도하세요.",
  openrouter: "OpenRouter 실행에 필요한 OpenCode CLI가 설치되어 있지 않습니다.",
} satisfies Record<AgentProvider, string>;

export type AgentUsageWindow = {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
};

export type ProviderUsageStatus = "ok" | "error" | "unavailable";

/** Per-provider quota report, mirroring what the desktop settings UI renders. */
export type ProviderUsageReport = {
  status: ProviderUsageStatus;
  session: AgentUsageWindow | null;
  weekly: AgentUsageWindow | null;
  monthly: AgentUsageWindow | null;
  planType: string | null;
  accountLabel: string | null;
  authenticated: boolean;
  /**
   * True when the stored credentials cannot be used again without a fresh
   * sign-in, so the UI must stop reporting the account as connected.
   */
  reauthenticationRequired: boolean;
  updatedAt: number;
  error: string | null;
};

export type ProviderUsageSnapshot = {
  providers: Partial<Record<AgentProvider, ProviderUsageReport>>;
  updatedAt: number;
};

export type ProviderUsageProbe = {
  exhausted: boolean;
  /** null when usage could not be determined. */
  maxUsedPercent: number | null;
  error: string | null;
};

export type ProviderUsageProbeDependencies = {
  home: string;
  now: () => number;
  probeTimeoutMs: number;
  cacheTtlMs: number;
  which: (provider: AgentProvider) => string | null;
  probe: (
    provider: AgentProvider,
    binary: string | null,
    home: string,
    now: number,
    timeoutMs: number,
  ) => Promise<ProviderUsageReport>;
};

type CacheEntry = {
  expiresAt: number;
  result: ProviderUsageProbe;
};

const usageCache = new Map<AgentProvider, CacheEntry>();

const clampPercent = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

const objectOrNull = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const usageReport = (
  input: Partial<ProviderUsageReport> & { status: ProviderUsageStatus },
): ProviderUsageReport => ({
  session: null,
  weekly: null,
  monthly: null,
  planType: null,
  accountLabel: null,
  authenticated: false,
  reauthenticationRequired: false,
  updatedAt: Date.now(),
  error: null,
  ...input,
});

const connectedWithoutWindows = (accountLabel: string | null = null) =>
  usageReport({ status: "ok", authenticated: true, accountLabel });

const providerWithoutUsage = (
  status: ProviderUsageStatus,
  error: string,
  accountLabel: string | null = null,
  authenticated = false,
) => usageReport({ status, error, accountLabel, authenticated });

/** Both quota surfaces treat "no windows" as connected, never as exhausted. */
const okUsage = (
  input: Pick<ProviderUsageReport, "session" | "weekly" | "monthly"> & {
    planType?: string | null;
    accountLabel?: string | null;
  },
) =>
  usageReport({
    status: "ok",
    authenticated: true,
    session: input.session,
    weekly: input.weekly,
    monthly: input.monthly,
    planType: input.planType ?? null,
    accountLabel: input.accountLabel ?? null,
  });

const parseResetTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return epochToMillis(value);
  }
  if (typeof value !== "string") return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && value.trim() !== ""
    ? epochToMillis(asNumber)
    : null;
};

/** Antigravity's CLI prints either an RFC 3339 string or an epoch value. */
export const parseCliResetTime = (value: unknown) => {
  if (typeof value === "string") {
    return parseIsoMillis(value) ?? parseResetTimestamp(value);
  }
  return parseResetTimestamp(value);
};

const parseCodexWindow = (
  value: unknown,
  fallbackMinutes: number,
): AgentUsageWindow | null => {
  const raw = objectOrNull(value);
  if (!raw) return null;
  const usedPercent = typeof raw.usedPercent === "number"
    ? raw.usedPercent
    : typeof raw.used_percent === "number"
      ? raw.used_percent
      : null;
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null;
  const windowMinutes = typeof raw.windowDurationMins === "number"
    ? raw.windowDurationMins
    : typeof raw.windowMinutes === "number"
      ? raw.windowMinutes
      : typeof raw.window_minutes === "number"
        ? raw.window_minutes
        : fallbackMinutes;
  const resetsAtRaw = typeof raw.resetsAt === "number"
    ? raw.resetsAt
    : typeof raw.resets_at === "number"
      ? raw.resets_at
      : null;
  return {
    usedPercent: clampPercent(usedPercent),
    windowMinutes,
    resetsAt: resetsAtRaw === null ? null : epochToMillis(resetsAtRaw),
  };
};

const classifyCodexWindows = (
  primary: AgentUsageWindow | null,
  secondary: AgentUsageWindow | null,
) => {
  let session: AgentUsageWindow | null = null;
  let weekly: AgentUsageWindow | null = null;
  for (const window of [primary, secondary]) {
    if (!window) continue;
    if (window.windowMinutes >= 24 * 60) weekly ??= window;
    else session ??= window;
  }
  return { session, weekly };
};

const CODEX_WITHOUT_USAGE =
  "Codex 계정에 usage 정보가 없습니다. 로그인 상태를 확인하세요.";

export type ProviderUsageResult =
  | { usage: ProviderUsageReport; error: null }
  | { usage: null; error: string };

export function parseCodexRateLimits(message: unknown): ProviderUsageResult {
  const root = objectOrNull(message);
  if (!root) return { usage: null, error: CODEX_WITHOUT_USAGE };
  const errorMessage = objectOrNull(root.error)?.message;
  if (typeof errorMessage === "string") {
    return { usage: null, error: errorMessage };
  }
  const rateLimits = objectOrNull(objectOrNull(root.result)?.rateLimits);
  if (!rateLimits) return { usage: null, error: CODEX_WITHOUT_USAGE };
  const { session, weekly } = classifyCodexWindows(
    parseCodexWindow(rateLimits.primary, 300),
    parseCodexWindow(rateLimits.secondary, 10_080),
  );
  if (!session && !weekly) return { usage: null, error: CODEX_WITHOUT_USAGE };
  return {
    usage: okUsage({
      session,
      weekly,
      monthly: null,
      planType: typeof rateLimits.planType === "string"
        ? rateLimits.planType
        : null,
    }),
    error: null,
  };
}

export async function probeCodexUsage(
  binary: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProviderUsageResult> {
  return await new Promise((resolve) => {
    const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      env: process.env,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    let stdout = "";
    let initialized = false;
    const finish = (result: ProviderUsageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ usage: null, error: "Codex usage 조회 시간이 초과되었습니다." });
    }, timeoutMs);

    const write = (message: Record<string, unknown>) => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish({ usage: null, error: "Codex usage 요청을 보내지 못했습니다." });
      }
    };

    child.on("error", (error) => {
      finish({
        usage: null,
        error: `Codex CLI를 시작하지 못했습니다: ${error.message}`,
      });
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const id = objectOrNull(message)?.id;
        if (id === 1 && !initialized) {
          initialized = true;
          write({ method: "initialized", params: {} });
          write({ method: "account/rateLimits/read", id: 2, params: {} });
          continue;
        }
        if (id === 2) finish(parseCodexRateLimits(message));
      }
    });
    child.on("close", () => {
      finish({
        usage: null,
        error: "Codex App Server가 usage를 반환하지 않았습니다.",
      });
    });

    write({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "briar", title: "Briar", version: "cli" },
      },
    });
  });
}

async function loadCodexUsage(
  home: string,
  binary: string | null,
  timeoutMs: number,
): Promise<ProviderUsageReport> {
  const identity = await readCodexAccountIdentity(home);
  const result = binary
    ? await probeCodexUsage(binary, timeoutMs)
    : {
      usage: null,
      error: providerMissingBinaryMessage.codex,
    } satisfies ProviderUsageResult;
  if (result.usage) {
    return {
      ...result.usage,
      accountLabel: identity.accountLabel,
      authenticated: true,
    };
  }
  return providerWithoutUsage(
    result.error.includes("CLI") || result.error.includes("로그인")
      ? "unavailable"
      : "error",
    result.error,
    identity.accountLabel,
    identity.authenticated,
  );
}

const parseClaudeWindow = (
  raw: unknown,
  minutes: number,
): AgentUsageWindow | null => {
  const entry = objectOrNull(raw);
  if (!entry) return null;
  const used = typeof entry.utilization === "number"
    ? entry.utilization
    : typeof entry.used_percentage === "number"
      ? entry.used_percentage
      : null;
  if (used === null || !Number.isFinite(used)) return null;
  return {
    usedPercent: clampPercent(used),
    windowMinutes: minutes,
    resetsAt: typeof entry.resets_at === "string"
      ? parseResetTimestamp(entry.resets_at) ?? parseIsoMillis(entry.resets_at)
      : parseResetTimestamp(entry.resets_at),
  };
};

export function parseClaudeUsageResponse(body: unknown): ProviderUsageResult {
  const entry = objectOrNull(body);
  if (!entry) {
    return { usage: null, error: "Claude usage 응답을 읽지 못했습니다." };
  }
  const session = parseClaudeWindow(entry.five_hour, 300);
  const weekly = parseClaudeWindow(entry.seven_day, 10_080);
  if (!session && !weekly) {
    return { usage: null, error: "Claude 계정에 usage 정보가 없습니다." };
  }
  return { usage: okUsage({ session, weekly, monthly: null }), error: null };
}

export type ClaudeUsageError = {
  message: string;
  reauthenticationRequired: boolean;
};

export function claudeUsageErrorForStatus(status: number): ClaudeUsageError {
  // The token was not expired locally, so the API rejecting it means the
  // credentials were revoked rather than simply gone stale.
  if (status === 401 || status === 403) {
    return {
      message: "Claude 인증이 거부되었습니다. `claude` 를 실행해 다시 로그인하세요.",
      reauthenticationRequired: true,
    };
  }
  return {
    message: status === 429
      ? "Claude usage 조회 한도에 도달했습니다. 잠시 후 다시 시도하세요."
      : `Claude usage를 불러오지 못했습니다. HTTP ${status}`,
    reauthenticationRequired: false,
  };
}

export async function probeClaudeUsage(
  accessToken: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageReport | ClaudeUsageError> {
  try {
    const response = await fetchImpl(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.0",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return claudeUsageErrorForStatus(response.status);
    const parsed = parseClaudeUsageResponse(await response.json());
    return parsed.usage ??
      { message: parsed.error, reauthenticationRequired: false };
  } catch (error) {
    return {
      message: `Claude usage를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
      reauthenticationRequired: false,
    };
  }
}

async function loadClaudeUsage(
  home: string,
  now: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ProviderUsageReport> {
  const credentials = await readClaudeCredentials(home);
  if (!credentials) {
    return providerWithoutUsage("unavailable", "Claude 로그인이 필요합니다.");
  }
  // Claude Code refreshes its access token lazily, so a lapsed token in the
  // credential store says nothing about whether the login itself is still
  // good. Only report an expired login once the refresh token is gone too.
  const state = claudeTokenState(credentials, now);
  if (state === "stale") {
    return providerWithoutUsage(
      "unavailable",
      "Claude 액세스 토큰이 만료되어 usage를 불러오지 못했습니다. Claude Code를 실행하면 자동으로 갱신됩니다.",
      credentials.accountLabel,
      true,
    );
  }
  if (state === "expired") {
    return {
      ...providerWithoutUsage(
        "error",
        "Claude 로그인이 만료되었습니다. `claude` 를 실행해 다시 로그인하세요.",
        credentials.accountLabel,
      ),
      reauthenticationRequired: true,
    };
  }
  const result = await probeClaudeUsage(
    credentials.accessToken,
    timeoutMs,
    fetchImpl,
  );
  if ("status" in result) {
    return {
      ...result,
      accountLabel: credentials.accountLabel,
      planType: credentials.planType,
      authenticated: true,
    };
  }
  return {
    ...providerWithoutUsage(
      "error",
      result.message,
      credentials.accountLabel,
      !result.reauthenticationRequired,
    ),
    reauthenticationRequired: result.reauthenticationRequired,
  };
}

const parseGrokMoney = (value: unknown) => {
  const raw = objectOrNull(value)?.val;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const timestampsMatch = (left?: string | null, right?: string | null) => {
  if (!left || !right) return false;
  const leftMs = parseIsoMillis(left);
  const rightMs = parseIsoMillis(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
};

const grokBillingConfig = (body: unknown) => {
  const root = objectOrNull(body);
  if (!root) return null;
  return objectOrNull(root.config) ?? root;
};

const grokPeriodEnd = (config: Record<string, unknown>) => {
  const period = objectOrNull(config.currentPeriod) ??
    objectOrNull(config.current_period);
  const periodEnd = typeof period?.end === "string" ? period.end : null;
  const billingEnd = typeof config.billingPeriodEnd === "string"
    ? config.billingPeriodEnd
    : typeof config.billing_period_end === "string"
      ? config.billing_period_end
      : null;
  const value = periodEnd ?? billingEnd;
  return value ? parseIsoMillis(value) : null;
};

export function parseGrokBilling(
  body: unknown,
  kind: "weekly" | "monthly",
): AgentUsageWindow | null {
  const config = grokBillingConfig(body);
  if (!config) return null;
  if (kind === "weekly") {
    const credit = typeof config.creditUsagePercent === "number"
      ? config.creditUsagePercent
      : typeof config.credit_usage_percent === "number"
        ? config.credit_usage_percent
        : null;
    const period = objectOrNull(config.currentPeriod) ??
      objectOrNull(config.current_period);
    const periodType = typeof period?.type === "string"
      ? period.type
      : typeof period?.kind === "string"
        ? period.kind
        : null;
    const billingStart = typeof config.billingPeriodStart === "string"
      ? config.billingPeriodStart
      : typeof config.billing_period_start === "string"
        ? config.billing_period_start
        : null;
    const billingEnd = typeof config.billingPeriodEnd === "string"
      ? config.billingPeriodEnd
      : typeof config.billing_period_end === "string"
        ? config.billing_period_end
        : null;
    const confirmedZero = credit === null &&
      periodType === "USAGE_PERIOD_TYPE_WEEKLY" &&
      timestampsMatch(
        typeof period?.start === "string" ? period.start : null,
        billingStart,
      ) &&
      timestampsMatch(
        typeof period?.end === "string" ? period.end : null,
        billingEnd,
      );
    const usedPercent = credit ?? (confirmedZero ? 0 : null);
    if (usedPercent === null) return null;
    return {
      usedPercent: clampPercent(usedPercent),
      windowMinutes: GROK_WEEKLY_MINUTES,
      resetsAt: grokPeriodEnd(config),
    };
  }

  const limit = parseGrokMoney(config.monthlyLimit ?? config.monthly_limit);
  const used = parseGrokMoney(config.used);
  if (limit === null || used === null || limit <= 0) return null;
  return {
    usedPercent: clampPercent((used / limit) * 100),
    windowMinutes: GROK_MONTHLY_MINUTES,
    resetsAt: grokPeriodEnd(config),
  };
}

async function fetchGrokBilling(
  url: string,
  session: GrokAuthSession,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ body: unknown; error: null } | { body: null; error: string }> {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    "X-XAI-Token-Auth": "xai-grok-cli",
    Accept: "application/json",
    ...(session.userId ? { "x-userid": session.userId } : {}),
  };
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    return {
      body: null,
      error: response.status === 401 || response.status === 403
        ? "Grok 로그인이 만료되었습니다."
        : `Grok usage를 불러오지 못했습니다. HTTP ${response.status}`,
    };
  }
  return { body: await response.json(), error: null };
}

export async function probeGrokUsage(
  session: GrokAuthSession,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageResult> {
  const proxyBase =
    process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim().replace(/\/+$/u, "") ||
    GROK_DEFAULT_PROXY_BASE;
  try {
    const credits = await fetchGrokBilling(
      `${proxyBase}/billing?format=credits`,
      session,
      timeoutMs,
      fetchImpl,
    );
    if (credits.error) return { usage: null, error: credits.error };
    const weekly = parseGrokBilling(credits.body, "weekly");
    let monthly: AgentUsageWindow | null = null;
    if (!weekly) {
      const monthlyBilling = await fetchGrokBilling(
        `${proxyBase}/billing`,
        session,
        timeoutMs,
        fetchImpl,
      );
      if (monthlyBilling.error) {
        return { usage: null, error: monthlyBilling.error };
      }
      monthly = parseGrokBilling(monthlyBilling.body, "monthly");
    }
    if (!weekly && !monthly) {
      return { usage: null, error: "Grok 계정에 usage 정보가 없습니다." };
    }
    const tier = grokBillingConfig(credits.body)?.subscriptionTier;
    return {
      usage: okUsage({
        session: null,
        weekly,
        monthly,
        planType: typeof tier === "string" && tier.trim() ? tier : null,
      }),
      error: null,
    };
  } catch (error) {
    return {
      usage: null,
      error: `Grok usage를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function loadGrokUsage(
  home: string,
  now: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ProviderUsageReport> {
  const lookup = await readGrokAuthSession(home, now);
  if (!lookup.session) {
    return providerWithoutUsage(
      lookup.error.includes("로그인") ? "unavailable" : "error",
      lookup.error,
    );
  }
  const { session } = lookup;
  if (
    session.expiresAt !== null &&
    session.expiresAt <= now + GROK_TOKEN_SKEW_MILLIS
  ) {
    return providerWithoutUsage(
      "error",
      "Grok 로그인이 만료되었습니다. Grok CLI를 실행해 인증을 갱신하세요.",
      session.accountLabel,
      true,
    );
  }
  const result = await probeGrokUsage(session, timeoutMs, fetchImpl);
  return result.usage
    ? { ...result.usage, accountLabel: session.accountLabel }
    : providerWithoutUsage("error", result.error, session.accountLabel, true);
}

const agyQuotaBucket = (value: unknown): AgentUsageWindow | null => {
  const entry = objectOrNull(value);
  const remaining = entry?.remainingFraction;
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  return {
    usedPercent: clampPercent((1 - remaining) * 100),
    windowMinutes: 60,
    resetsAt: typeof entry?.resetTime === "string"
      ? parseIsoMillis(entry.resetTime)
      : null,
  };
};

export function parseAgyQuota(body: unknown): ProviderUsageResult {
  const root = objectOrNull(body);
  const rawBuckets = Array.isArray(body)
    ? body
    : Array.isArray(root?.buckets)
      ? root.buckets
      : [];
  const windows = rawBuckets.flatMap((entry) => {
    const window = agyQuotaBucket(entry);
    return window ? [window] : [];
  });
  const session = windows.reduce<AgentUsageWindow | null>(
    (worst, window) =>
      worst && worst.usedPercent >= window.usedPercent ? worst : window,
    null,
  );
  return {
    usage: okUsage({ session, weekly: null, monthly: null }),
    error: null,
  };
}

/** `agy --print /quota --output-format json` payload. */
export function parseAgyCliQuota(value: unknown): ProviderUsageResult {
  const command = objectOrNull(objectOrNull(value)?.command);
  const name = command?.name;
  if (typeof name !== "string") {
    return {
      usage: null,
      error: "올바르지 않은 CLI quota 형식입니다: command name이 누락되었습니다.",
    };
  }
  if (name !== "usage") {
    return {
      usage: null,
      error:
        `올바르지 않은 command name입니다: 'usage'를 예상했으나 '${name}'를 받았습니다.`,
    };
  }
  const groups = objectOrNull(command?.data)?.groups;
  if (!Array.isArray(groups)) {
    return {
      usage: null,
      error: "올바르지 않은 CLI quota 형식입니다: groups 형식이 잘못되었습니다.",
    };
  }
  const gemini = groups.find((group) => {
    const groupName = objectOrNull(group)?.name;
    return typeof groupName === "string" &&
      groupName.toLowerCase() === "gemini models";
  });
  const buckets = objectOrNull(gemini)?.buckets;
  if (!Array.isArray(buckets)) {
    return { usage: null, error: "quota에서 Gemini Models 그룹을 찾을 수 없습니다." };
  }
  let session: AgentUsageWindow | null = null;
  let weekly: AgentUsageWindow | null = null;
  for (const raw of buckets) {
    const bucket = objectOrNull(raw);
    const remaining = bucket?.remaining_fraction;
    const window = bucket?.window;
    if (typeof remaining !== "number" || typeof window !== "string") continue;
    const mapped: AgentUsageWindow = {
      usedPercent: clampPercent((1 - remaining) * 100),
      windowMinutes: window === "5h" ? 300 : 10_080,
      resetsAt: parseCliResetTime(bucket?.reset_time),
    };
    if (window === "5h") session = mapped;
    else if (window === "weekly") weekly = mapped;
  }
  return { usage: okUsage({ session, weekly, monthly: null }), error: null };
}

function fetchAgyUsageCli(
  binary: string,
  timeoutMs: number,
): ProviderUsageResult {
  const result = spawnSync(
    binary,
    ["--print", "/quota", "--output-format", "json"],
    { encoding: "utf8", env: process.env, timeout: timeoutMs },
  );
  if (result.error) {
    return {
      usage: null,
      error: "signal" in result && result.signal
        ? "Antigravity CLI usage 조회 시간이 초과되었습니다."
        : `Antigravity CLI를 시작하지 못했습니다: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      usage: null,
      error: `Antigravity CLI가 오류를 반환했습니다 (exit code: ${
        result.status ?? "null"
      }): ${result.stderr.trim()}`,
    };
  }
  try {
    return parseAgyCliQuota(JSON.parse(result.stdout));
  } catch (error) {
    return {
      usage: null,
      error: `Antigravity CLI JSON 파싱에 실패했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

type AgyProjectLookup =
  | { project: string; error: null }
  | { project: null; error: string };

async function fetchAgyProjectId(
  accessToken: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<AgyProjectLookup> {
  const configured = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (configured) return { project: configured, error: null };
  const response = await fetchImpl(AGY_LOAD_ASSIST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    return {
      project: null,
      error: response.status === 401 || response.status === 403
        ? "Antigravity 로그인이 만료되었습니다."
        : `Antigravity 프로젝트를 불러오지 못했습니다. HTTP ${response.status}`,
    };
  }
  const body = objectOrNull(await response.json());
  const project = typeof body?.cloudaicompanionProject === "string"
    ? body.cloudaicompanionProject.trim()
    : "";
  return project
    ? { project, error: null }
    : { project: null, error: "Antigravity 프로젝트 ID를 찾지 못했습니다." };
}

export async function probeAgyUsage(
  accessToken: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageResult> {
  try {
    const lookup = await fetchAgyProjectId(accessToken, timeoutMs, fetchImpl);
    if (lookup.error !== null) return { usage: null, error: lookup.error };
    const { project } = lookup;
    const response = await fetchImpl(AGY_QUOTA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        usage: null,
        error: response.status === 401 || response.status === 403
          ? "Antigravity 로그인이 만료되었습니다."
          : `Antigravity usage를 불러오지 못했습니다. HTTP ${response.status}`,
      };
    }
    return parseAgyQuota(await response.json());
  } catch (error) {
    return {
      usage: null,
      error: `Antigravity usage를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function loadAgyUsage(
  home: string,
  binary: string | null,
  now: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ProviderUsageReport> {
  if (!binary) {
    return providerWithoutUsage("unavailable", providerMissingBinaryMessage.agy);
  }
  const authenticated = await agyAuthenticated(binary);
  const cli = authenticated
    ? fetchAgyUsageCli(binary, timeoutMs)
    : { usage: null, error: "Antigravity CLI가 인증되지 않았습니다." } satisfies
      ProviderUsageResult;
  if (cli.usage) {
    return {
      ...cli.usage,
      accountLabel: await readGeminiOauthEmail(home),
      authenticated: true,
    };
  }
  const credentials = await readGeminiOauthAccess(home, now);
  if (credentials) {
    const api = await probeAgyUsage(
      credentials.accessToken,
      timeoutMs,
      fetchImpl,
    );
    if (api.usage) {
      return {
        ...api.usage,
        accountLabel: credentials.email,
        authenticated: true,
      };
    }
    return providerWithoutUsage(
      authenticated ? "error" : "unavailable",
      `CLI 오류: ${cli.error}; API 오류: ${api.error}`,
      credentials.email,
      authenticated,
    );
  }
  if (authenticated) {
    return providerWithoutUsage(
      "error",
      `CLI 오류: ${cli.error}`,
      await readGeminiOauthEmail(home),
      true,
    );
  }
  return providerWithoutUsage("unavailable", "Antigravity 로그인이 필요합니다.");
}

const parseOpencodeUsageWindow = (
  value: unknown,
  minutes: number,
): AgentUsageWindow | null => {
  const entry = objectOrNull(value);
  if (!entry) return null;
  const percent = typeof entry.percent === "number" ? entry.percent : null;
  if (percent === null || !Number.isFinite(percent)) return null;
  return {
    usedPercent: clampPercent(percent),
    windowMinutes: minutes,
    resetsAt: typeof entry.resetsAt === "string"
      ? parseIsoMillis(entry.resetsAt)
      : parseResetTimestamp(entry.resetsAt),
  };
};

export function parseOpencodeUsageResponse(body: unknown): ProviderUsageResult {
  const windows = objectOrNull(objectOrNull(body)?.usage);
  if (!windows) {
    return { usage: null, error: "OpenCode usage 응답을 읽지 못했습니다." };
  }
  const session = parseOpencodeUsageWindow(
    windows.rolling,
    OPENCODE_ROLLING_MINUTES,
  );
  const weekly = parseOpencodeUsageWindow(
    windows.weekly,
    OPENCODE_WEEKLY_MINUTES,
  );
  const monthly = parseOpencodeUsageWindow(
    windows.monthly,
    OPENCODE_MONTHLY_MINUTES,
  );
  if (!session && !weekly && !monthly) {
    return { usage: null, error: "OpenCode 계정에 usage 정보가 없습니다." };
  }
  return { usage: okUsage({ session, weekly, monthly }), error: null };
}

export type OpencodeUsageError = {
  message: string;
  reauthenticationRequired: boolean;
};

export function opencodeUsageErrorForStatus(
  status: number,
): OpencodeUsageError {
  // The Go key comes straight from `auth.json`, so the API rejecting it means
  // the stored login itself is no longer valid.
  if (status === 401 || status === 403) {
    return {
      message:
        "OpenCode 인증이 거부되었습니다. `opencode auth login`을 실행해 다시 로그인하세요.",
      reauthenticationRequired: true,
    };
  }
  return {
    message: `OpenCode usage를 불러오지 못했습니다. HTTP ${status}`,
    reauthenticationRequired: false,
  };
}

export async function probeOpencodeUsage(
  apiKey: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageReport | OpencodeUsageError> {
  try {
    const response = await fetchImpl(OPENCODE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return opencodeUsageErrorForStatus(response.status);
    const parsed = parseOpencodeUsageResponse(await response.json());
    return parsed.usage ??
      { message: parsed.error, reauthenticationRequired: false };
  } catch (error) {
    return {
      message: `OpenCode usage를 불러오지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
      reauthenticationRequired: false,
    };
  }
}

async function loadOpencodeUsage(
  home: string,
  binary: string | null,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<ProviderUsageReport> {
  const identity = await readOpencodeAccountIdentity(home, binary !== null);
  if (!identity.authenticated) {
    return providerWithoutUsage("unavailable", "OpenCode CLI가 필요합니다.");
  }
  const apiKey = await readOpencodeGoKey(home);
  // Without a Go key there is no usage API to call; the account stays
  // connected exactly as before instead of failing the probe.
  if (!apiKey) return connectedWithoutWindows(identity.accountLabel);
  const result = await probeOpencodeUsage(apiKey, timeoutMs, fetchImpl);
  if ("status" in result) {
    return { ...result, accountLabel: identity.accountLabel, authenticated: true };
  }
  return {
    ...providerWithoutUsage(
      "error",
      result.message,
      identity.accountLabel,
      !result.reauthenticationRequired,
    ),
    reauthenticationRequired: result.reauthenticationRequired,
  };
}

function loadCursorUsage(binary: string | null): ProviderUsageReport {
  if (process.env.CURSOR_API_KEY?.trim()) return connectedWithoutWindows();
  if (!binary) {
    return providerWithoutUsage(
      "unavailable",
      providerMissingBinaryMessage.cursor,
    );
  }
  const identity = readCursorAccountIdentity(binary);
  return identity.authenticated
    ? connectedWithoutWindows(identity.accountLabel)
    : providerWithoutUsage("unavailable", "Cursor 로그인이 필요합니다.");
}

export function loadOpenrouterUsage(configured: boolean): ProviderUsageReport {
  return configured
    ? connectedWithoutWindows()
    : providerWithoutUsage("unavailable", "OpenRouter API 키가 필요합니다.");
}

export type ProviderUsageSnapshotOptions = {
  home?: string;
  now?: number;
  openrouterConfigured?: boolean;
  providers?: readonly AgentProvider[];
  timeoutMs?: number;
  which?: (provider: AgentProvider) => string | null;
  fetchImpl?: typeof fetch;
};

const defaultWhich = (provider: AgentProvider) =>
  Bun.which(agentProviderBinaryName(provider));

export async function loadProviderUsage(
  provider: AgentProvider,
  options: ProviderUsageSnapshotOptions = {},
): Promise<ProviderUsageReport> {
  const home = options.home ?? homedir();
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const binary = (options.which ?? defaultWhich)(provider);
  if (provider === "codex") return loadCodexUsage(home, binary, timeoutMs);
  if (provider === "claude") {
    return loadClaudeUsage(home, now, timeoutMs, fetchImpl);
  }
  if (provider === "grok") return loadGrokUsage(home, now, timeoutMs, fetchImpl);
  if (provider === "agy") {
    return loadAgyUsage(home, binary, now, timeoutMs, fetchImpl);
  }
  if (provider === "opencode") {
    return loadOpencodeUsage(home, binary, timeoutMs, fetchImpl);
  }
  if (provider === "cursor") return loadCursorUsage(binary);
  return loadOpenrouterUsage(options.openrouterConfigured === true);
}

/** Probe every requested provider in parallel, exactly like the desktop did. */
export async function loadProviderUsageSnapshot(
  options: ProviderUsageSnapshotOptions = {},
): Promise<ProviderUsageSnapshot> {
  const requested = options.providers ?? agentProviders;
  const entries = await Promise.all(
    requested.map(async (provider) =>
      [provider, await loadProviderUsage(provider, options)] as const
    ),
  );
  return {
    providers: Object.fromEntries(entries) as ProviderUsageSnapshot["providers"],
    updatedAt: Date.now(),
  };
}

const maxUsedPercent = (usage: ProviderUsageReport) => {
  const values = [usage.session, usage.weekly, usage.monthly]
    .filter((window): window is AgentUsageWindow => window !== null)
    .map((window) => window.usedPercent);
  return values.length === 0 ? null : Math.max(...values);
};

/** Worker-side view: unknown usage deliberately fails open. */
export const providerUsageProbe = (
  usage: ProviderUsageReport,
): ProviderUsageProbe => ({
  exhausted: isProviderUsageExhausted(usage),
  maxUsedPercent: maxUsedPercent(usage),
  error: usage.error,
});

const defaultDependencies: ProviderUsageProbeDependencies = {
  home: homedir(),
  now: Date.now,
  probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  which: defaultWhich,
  probe: async (provider, binary, home, now, timeoutMs) =>
    loadProviderUsage(provider, {
      home,
      now,
      timeoutMs,
      which: () => binary,
    }),
};

export function clearProviderUsageCache() {
  usageCache.clear();
}

export async function probeWorkerProviderUsage(
  provider: AgentProvider,
  dependencies: Partial<ProviderUsageProbeDependencies> = {},
): Promise<ProviderUsageProbe> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const cached = usageCache.get(provider);
  const now = resolved.now();
  if (cached && cached.expiresAt > now) return cached.result;
  const binary = resolved.which(provider);
  const result = providerUsageProbe(
    await resolved.probe(
      provider,
      binary,
      resolved.home,
      now,
      resolved.probeTimeoutMs,
    ),
  );
  usageCache.set(provider, {
    expiresAt: now + resolved.cacheTtlMs,
    result,
  });
  return result;
}
