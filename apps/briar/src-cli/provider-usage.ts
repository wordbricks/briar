import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  agentProviderBinaryName,
  type AgentProvider,
} from "../src/lib/agent-provider";
import {
  isProviderUsageExhausted,
  type AgentUsageProvider,
} from "../src/lib/agent-usage";
import type { AgentUsageWindow } from "../src/generated/tauri";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const AGY_LOAD_ASSIST_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const AGY_QUOTA_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const GROK_DEFAULT_PROXY_BASE = "https://cli-chat-proxy.grok.com/v1";
const GROK_WEEKLY_MINUTES = 10_080;
const GROK_MONTHLY_MINUTES = 43_200;
const GROK_TOKEN_SKEW_MILLIS = 5 * 60_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

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
  ) => Promise<ProviderUsageProbe>;
};

type CacheEntry = {
  expiresAt: number;
  result: ProviderUsageProbe;
};

const usageCache = new Map<AgentProvider, CacheEntry>();

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const epochToMillis = (value: number) =>
  value < 10_000_000_000 ? value * 1_000 : value;

const parseIsoMillis = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maxUsedPercent = (
  windows: Array<AgentUsageWindow | null | undefined>,
) => {
  const values = windows
    .filter((window): window is AgentUsageWindow => window != null)
    .map((window) => window.usedPercent);
  if (values.length === 0) return null;
  return Math.max(...values);
};

const unknownUsage = (error: string | null = null): ProviderUsageProbe => ({
  exhausted: false,
  maxUsedPercent: null,
  error,
});

const exhaustedFromWindows = (
  status: AgentUsageProvider["status"],
  session: AgentUsageWindow | null,
  weekly: AgentUsageWindow | null,
  monthly: AgentUsageWindow | null,
  error: string | null = null,
): ProviderUsageProbe => {
  const exhausted = isProviderUsageExhausted({
    status,
    session,
    weekly,
    monthly,
  });
  return {
    exhausted,
    maxUsedPercent: maxUsedPercent([session, weekly, monthly]),
    error,
  };
};

const parseCodexWindow = (
  value: unknown,
  fallbackMinutes: number,
): AgentUsageWindow | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const usedPercent =
    typeof raw.usedPercent === "number"
      ? raw.usedPercent
      : typeof raw.used_percent === "number"
        ? raw.used_percent
        : null;
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null;
  const windowMinutes =
    typeof raw.windowDurationMins === "number"
      ? raw.windowDurationMins
      : typeof raw.windowMinutes === "number"
        ? raw.windowMinutes
        : typeof raw.window_minutes === "number"
          ? raw.window_minutes
          : fallbackMinutes;
  const resetsAtRaw =
    typeof raw.resetsAt === "number"
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
    if (window.windowMinutes >= 24 * 60) {
      weekly ??= window;
    } else {
      session ??= window;
    }
  }
  return { session, weekly };
};

export function parseCodexRateLimits(message: unknown): ProviderUsageProbe {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return unknownUsage("Codex usage response was not an object.");
  }
  const root = message as Record<string, unknown>;
  const errorMessage =
    root.error &&
    typeof root.error === "object" &&
    !Array.isArray(root.error) &&
    typeof (root.error as { message?: unknown }).message === "string"
      ? ((root.error as { message: string }).message)
      : null;
  if (errorMessage) return unknownUsage(errorMessage);

  const result = root.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return unknownUsage("Codex account has no usage information.");
  }
  const rateLimits = (result as { rateLimits?: unknown }).rateLimits;
  if (!rateLimits || typeof rateLimits !== "object" || Array.isArray(rateLimits)) {
    return unknownUsage("Codex account has no usage information.");
  }
  const limits = rateLimits as Record<string, unknown>;
  const primary = parseCodexWindow(limits.primary, 300);
  const secondary = parseCodexWindow(limits.secondary, 10_080);
  const { session, weekly } = classifyCodexWindows(primary, secondary);
  if (!session && !weekly) {
    return unknownUsage("Codex account has no usage information.");
  }
  return exhaustedFromWindows("ok", session, weekly, null);
}

export async function probeCodexUsage(
  binary: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProviderUsageProbe> {
  return await new Promise((resolve) => {
    const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
      env: process.env,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    let stdout = "";
    let initialized = false;
    const finish = (result: ProviderUsageProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish(unknownUsage("Codex usage probe timed out."));
    }, timeoutMs);

    const write = (message: Record<string, unknown>) => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(unknownUsage("Failed to write Codex usage request."));
      }
    };

    child.on("error", (error) => {
      finish(unknownUsage(`Failed to start Codex CLI: ${error.message}`));
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
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          continue;
        }
        const id = (message as { id?: unknown }).id;
        if (id === 1 && !initialized) {
          initialized = true;
          write({ method: "initialized", params: {} });
          write({
            method: "account/rateLimits/read",
            id: 2,
            params: {},
          });
          continue;
        }
        if (id === 2) {
          finish(parseCodexRateLimits(message));
        }
      }
    });
    child.on("close", () => {
      if (!settled) {
        finish(unknownUsage("Codex App Server closed without usage data."));
      }
    });

    write({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: {
          name: "briar",
          title: "Briar",
          version: "cli",
        },
      },
    });
  });
}

const parseClaudeWindow = (
  raw: unknown,
  minutes: number,
): AgentUsageWindow | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const used =
    typeof entry.utilization === "number"
      ? entry.utilization
      : typeof entry.used_percentage === "number"
        ? entry.used_percentage
        : null;
  if (used === null || !Number.isFinite(used)) return null;
  let resetsAt: number | null = null;
  if (typeof entry.resets_at === "number") {
    resetsAt = epochToMillis(entry.resets_at);
  } else if (typeof entry.resets_at === "string") {
    const asNumber = Number(entry.resets_at);
    if (Number.isFinite(asNumber)) resetsAt = epochToMillis(asNumber);
    else resetsAt = parseIsoMillis(entry.resets_at);
  }
  return {
    usedPercent: clampPercent(used),
    windowMinutes: minutes,
    resetsAt,
  };
};

export function parseClaudeUsageResponse(body: unknown): ProviderUsageProbe {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return unknownUsage("Claude usage response was not an object.");
  }
  const entry = body as Record<string, unknown>;
  const session = parseClaudeWindow(entry.five_hour, 300);
  const weekly = parseClaudeWindow(entry.seven_day, 10_080);
  if (!session && !weekly) {
    return unknownUsage("Claude account has no usage information.");
  }
  return exhaustedFromWindows("ok", session, weekly, null);
}

const readClaudeCredentialsFromFile = async (home: string) => {
  const configDirectory =
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const contents = await readFile(
    join(configDirectory, ".credentials.json"),
    "utf8",
  );
  return contents;
};

const readClaudeCredentialsFromKeychain = (home: string) => {
  if (process.platform !== "darwin") return null;
  const account =
    process.env.USER?.trim() || process.env.USERNAME?.trim() || "user";
  const configDirectory =
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
  const digest = createHash("sha256").update(configDirectory).digest("hex");
  const suffix = digest.slice(0, 8);
  for (const service of [
    `Claude Code-credentials-${suffix}`,
    "Claude Code-credentials",
  ]) {
    const result = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return null;
};

const extractClaudeAccessToken = (credentials: string) => {
  try {
    const parsed = JSON.parse(credentials) as {
      claudeAiOauth?: { accessToken?: string; access_token?: string };
    };
    const token =
      parsed.claudeAiOauth?.accessToken ??
      parsed.claudeAiOauth?.access_token ??
      null;
    return token && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
};

export async function probeClaudeUsage(
  home: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageProbe> {
  let credentials: string | null = null;
  try {
    credentials = await readClaudeCredentialsFromFile(home);
  } catch {
    credentials = readClaudeCredentialsFromKeychain(home);
  }
  if (!credentials) {
    return unknownUsage("Claude login is required.");
  }
  const accessToken = extractClaudeAccessToken(credentials);
  if (!accessToken) {
    return unknownUsage("Claude login is required.");
  }
  try {
    const response = await fetchImpl(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.0",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return unknownUsage("Claude login has expired.");
      }
      return unknownUsage(
        `Failed to load Claude usage. HTTP ${response.status}`,
      );
    }
    return parseClaudeUsageResponse(await response.json());
  } catch (error) {
    return unknownUsage(
      error instanceof Error
        ? error.message
        : "Failed to load Claude usage.",
    );
  }
}

type GrokAuthSession = {
  accessToken: string;
  userId: string | null;
  expiresAt: number | null;
};

const parseGrokAuthSession = (
  contents: string,
  now: number,
): GrokAuthSession | null => {
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    let preferred: GrokAuthSession | null = null;
    let fallback: GrokAuthSession | null = null;
    for (const [issuer, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.key !== "string" || entry.key.length === 0) continue;
      const expiresAt =
        typeof entry.expires_at === "string"
          ? parseIsoMillis(entry.expires_at)
          : typeof entry.expiresAt === "string"
            ? parseIsoMillis(entry.expiresAt)
            : null;
      const session: GrokAuthSession = {
        accessToken: entry.key,
        userId:
          typeof entry.user_id === "string"
            ? entry.user_id
            : typeof entry.userId === "string"
              ? entry.userId
              : null,
        expiresAt,
      };
      const isPreferred =
        issuer === "https://auth.x.ai" ||
        issuer.startsWith("https://auth.x.ai::");
      const fresh =
        expiresAt === null || expiresAt > now + GROK_TOKEN_SKEW_MILLIS;
      if (isPreferred && fresh) return session;
      if (isPreferred) preferred ??= session;
      else if (fresh) fallback ??= session;
    }
    return preferred ?? fallback;
  } catch {
    return null;
  }
};

const parseGrokMoney = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as { val?: unknown }).val;
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

export function parseGrokBilling(
  body: unknown,
  kind: "weekly" | "monthly",
): AgentUsageWindow | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? (root.config as Record<string, unknown>)
      : root;
  if (kind === "weekly") {
    const credit =
      typeof config.creditUsagePercent === "number"
        ? config.creditUsagePercent
        : typeof config.credit_usage_percent === "number"
          ? config.credit_usage_percent
          : null;
    const period =
      config.currentPeriod &&
      typeof config.currentPeriod === "object" &&
      !Array.isArray(config.currentPeriod)
        ? (config.currentPeriod as Record<string, unknown>)
        : config.current_period &&
            typeof config.current_period === "object" &&
            !Array.isArray(config.current_period)
          ? (config.current_period as Record<string, unknown>)
          : null;
    const periodType =
      typeof period?.type === "string"
        ? period.type
        : typeof period?.kind === "string"
          ? period.kind
          : null;
    const periodStart =
      typeof period?.start === "string" ? period.start : null;
    const periodEnd = typeof period?.end === "string" ? period.end : null;
    const billingStart =
      typeof config.billingPeriodStart === "string"
        ? config.billingPeriodStart
        : typeof config.billing_period_start === "string"
          ? config.billing_period_start
          : null;
    const billingEnd =
      typeof config.billingPeriodEnd === "string"
        ? config.billingPeriodEnd
        : typeof config.billing_period_end === "string"
          ? config.billing_period_end
          : null;
    const confirmedZero =
      credit === null &&
      periodType === "USAGE_PERIOD_TYPE_WEEKLY" &&
      timestampsMatch(periodStart, billingStart) &&
      timestampsMatch(periodEnd, billingEnd);
    const usedPercent = credit ?? (confirmedZero ? 0 : null);
    if (usedPercent === null) return null;
    return {
      usedPercent: clampPercent(usedPercent),
      windowMinutes: GROK_WEEKLY_MINUTES,
      resetsAt: periodEnd
        ? parseIsoMillis(periodEnd)
        : billingEnd
          ? parseIsoMillis(billingEnd)
          : null,
    };
  }

  const limit = parseGrokMoney(
    config.monthlyLimit ?? config.monthly_limit ?? null,
  );
  const used = parseGrokMoney(config.used ?? null);
  if (limit === null || used === null || limit <= 0) return null;
  const period =
    config.currentPeriod &&
    typeof config.currentPeriod === "object" &&
    !Array.isArray(config.currentPeriod)
      ? (config.currentPeriod as Record<string, unknown>)
      : null;
  const periodEnd = typeof period?.end === "string" ? period.end : null;
  const billingEnd =
    typeof config.billingPeriodEnd === "string"
      ? config.billingPeriodEnd
      : typeof config.billing_period_end === "string"
        ? config.billing_period_end
        : null;
  return {
    usedPercent: clampPercent((used / limit) * 100),
    windowMinutes: GROK_MONTHLY_MINUTES,
    resetsAt: periodEnd
      ? parseIsoMillis(periodEnd)
      : billingEnd
        ? parseIsoMillis(billingEnd)
        : null,
  };
}

export async function probeGrokUsage(
  home: string,
  now = Date.now(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageProbe> {
  const grokHome = process.env.GROK_HOME?.trim() || join(home, ".grok");
  let contents: string;
  try {
    contents = await readFile(join(grokHome, "auth.json"), "utf8");
  } catch {
    return unknownUsage("Grok login is required.");
  }
  const session = parseGrokAuthSession(contents, now);
  if (!session) {
    return unknownUsage("Grok login is required.");
  }
  if (
    session.expiresAt !== null &&
    session.expiresAt <= now + GROK_TOKEN_SKEW_MILLIS
  ) {
    return unknownUsage("Grok login has expired.");
  }
  const proxyBase =
    process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim().replace(/\/+$/u, "") ||
    GROK_DEFAULT_PROXY_BASE;
  const headers: Record<string, string> = {};
  headers.Authorization = `Bearer ${session.accessToken}`;
  headers["X-XAI-Token-Auth"] = "xai-grok-cli";
  headers.Accept = "application/json";
  if (session.userId) headers["x-userid"] = session.userId;

  try {
    const creditsResponse = await fetchImpl(
      `${proxyBase}/billing?format=credits`,
      {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!creditsResponse.ok) {
      if (creditsResponse.status === 401 || creditsResponse.status === 403) {
        return unknownUsage("Grok login has expired.");
      }
      return unknownUsage(
        `Failed to load Grok usage. HTTP ${creditsResponse.status}`,
      );
    }
    const creditsBody = await creditsResponse.json();
    const weekly = parseGrokBilling(creditsBody, "weekly");
    let monthly: AgentUsageWindow | null = null;
    if (!weekly) {
      const monthlyResponse = await fetchImpl(`${proxyBase}/billing`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (monthlyResponse.ok) {
        monthly = parseGrokBilling(await monthlyResponse.json(), "monthly");
      }
    }
    if (!weekly && !monthly) {
      return unknownUsage("Grok account has no usage information.");
    }
    return exhaustedFromWindows("ok", null, weekly, monthly);
  } catch (error) {
    return unknownUsage(
      error instanceof Error ? error.message : "Failed to load Grok usage.",
    );
  }
}

const parseGeminiOauthAccess = (contents: string, now: number) => {
  try {
    const parsed = JSON.parse(contents) as {
      access_token?: string;
      expiry_date?: number;
    };
    const accessToken = parsed.access_token?.trim();
    if (!accessToken) return null;
    if (
      typeof parsed.expiry_date === "number" &&
      parsed.expiry_date <= now
    ) {
      return null;
    }
    return accessToken;
  } catch {
    return null;
  }
};

export function parseAgyQuota(body: unknown): ProviderUsageProbe {
  if (!body || typeof body !== "object") {
    return unknownUsage("Antigravity usage response was not an object.");
  }
  const root = body as Record<string, unknown>;
  const rawBuckets = Array.isArray(body)
    ? body
    : Array.isArray(root.buckets)
      ? root.buckets
      : [];
  const windows = rawBuckets.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const remaining = (entry as { remainingFraction?: unknown }).remainingFraction;
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) return [];
    const resetTime = (entry as { resetTime?: unknown }).resetTime;
    return [
      {
        usedPercent: clampPercent((1 - remaining) * 100),
        windowMinutes: 60,
        resetsAt:
          typeof resetTime === "string" ? parseIsoMillis(resetTime) : null,
      } satisfies AgentUsageWindow,
    ];
  });
  if (windows.length === 0) {
    return exhaustedFromWindows("ok", null, null, null);
  }
  const session = windows.reduce((worst, window) =>
    window.usedPercent > worst.usedPercent ? window : worst,
  );
  return exhaustedFromWindows("ok", session, null, null);
}

export async function probeAgyUsage(
  home: string,
  now = Date.now(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderUsageProbe> {
  const credsPath =
    process.env.GEMINI_OAUTH_CREDS?.trim() ||
    join(home, ".gemini", "oauth_creds.json");
  let contents: string;
  try {
    contents = await readFile(credsPath, "utf8");
  } catch {
    return unknownUsage(null);
  }
  const accessToken = parseGeminiOauthAccess(contents, now);
  if (!accessToken) {
    return unknownUsage(null);
  }
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  try {
    const project =
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      (await (async () => {
        const response = await fetchImpl(AGY_LOAD_ASSIST_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({
            metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          cloudaicompanionProject?: string;
        };
        return body.cloudaicompanionProject?.trim() || null;
      })());
    if (!project) return unknownUsage(null);
    const response = await fetchImpl(AGY_QUOTA_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ project }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return unknownUsage(
        `Failed to load Antigravity usage. HTTP ${response.status}`,
      );
    }
    return parseAgyQuota(await response.json());
  } catch (error) {
    return unknownUsage(
      error instanceof Error
        ? error.message
        : "Failed to load Antigravity usage.",
    );
  }
}

const defaultProbe: ProviderUsageProbeDependencies["probe"] = async (
  provider,
  binary,
  home,
  now,
  timeoutMs,
) => {
  if (provider === "codex") {
    if (!binary) return unknownUsage("Codex CLI is not installed.");
    return probeCodexUsage(binary, timeoutMs);
  }
  if (provider === "claude") {
    return probeClaudeUsage(home, timeoutMs);
  }
  if (provider === "grok") {
    return probeGrokUsage(home, now, timeoutMs);
  }
  if (provider === "agy") {
    return probeAgyUsage(home, now, timeoutMs);
  }
  // Cursor and OpenCode have no stable first-class quota surface in Briar yet.
  // Unknown usage deliberately fails open.
  return unknownUsage(null);
};

const defaultDependencies: ProviderUsageProbeDependencies = {
  home: homedir(),
  now: Date.now,
  probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  which: (provider) => Bun.which(agentProviderBinaryName(provider)),
  probe: defaultProbe,
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
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }
  const binary = resolved.which(provider);
  const result = await resolved.probe(
    provider,
    binary,
    resolved.home,
    now,
    resolved.probeTimeoutMs,
  );
  usageCache.set(provider, {
    expiresAt: now + resolved.cacheTtlMs,
    result,
  });
  return result;
}
