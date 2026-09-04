import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Provider credential stores and sign-in state. Every Briar surface reads a
 * provider login through this module: the desktop app asks the CLI instead of
 * re-implementing the same credential files and Keychain entries in Rust.
 */

export const CLAUDE_TOKEN_SKEW_MILLIS = 5 * 60_000;
export const GROK_TOKEN_SKEW_MILLIS = 5 * 60_000;

const COMMAND_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 5_000;

export type ProviderAccountIdentity = {
  authenticated: boolean;
  accountLabel: string | null;
};

const unauthenticated: ProviderAccountIdentity = {
  authenticated: false,
  accountLabel: null,
};

export const parseIsoMillis = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const epochToMillis = (value: number) =>
  value < 10_000_000_000 ? value * 1_000 : value;

/** Reject the placeholder text a provider CLI prints instead of an account. */
export const usableAccountLabel = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const label = value.trim();
  const lowered = label.toLowerCase();
  if (
    !label ||
    lowered === "not logged in" ||
    lowered.includes("login required") ||
    lowered.includes("authentication required")
  ) {
    return null;
  }
  return label;
};

export const jwtEmail = (token: string): string | null => {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const profile = decoded["https://api.openai.com/profile"];
    const email = typeof decoded.email === "string"
      ? decoded.email
      : profile && typeof profile === "object" && !Array.isArray(profile)
        ? (profile as { email?: unknown }).email
        : null;
    return typeof email === "string" && email.trim() ? email.trim() : null;
  } catch {
    return null;
  }
};

const commandResult = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) =>
  spawnSync(binary, args, {
    encoding: "utf8",
    env,
    timeout: COMMAND_TIMEOUT_MS,
  });

const withoutGoogleCredentials = () => {
  const env = { ...process.env };
  for (
    const key of [
      "AGY_ADC_AUTH",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]
  ) {
    delete env[key];
  }
  return env;
};

const readJsonFile = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
};

const objectOrNull = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const codexHome = (home: string) =>
  process.env.CODEX_HOME?.trim() || join(home, ".codex");

/** Codex stores an API key or OAuth tokens in `auth.json`. */
export async function readCodexAccountIdentity(
  home: string,
): Promise<ProviderAccountIdentity> {
  const auth = objectOrNull(await readJsonFile(join(codexHome(home), "auth.json")));
  if (!auth) return unauthenticated;
  const apiKey = auth.OPENAI_API_KEY;
  const hasApiKey = typeof apiKey === "string" && apiKey.trim().length > 0;
  const tokens = objectOrNull(auth.tokens);
  const idToken = tokens
    ? typeof tokens.id_token === "string"
      ? tokens.id_token
      : typeof tokens.idToken === "string"
        ? tokens.idToken
        : null
    : null;
  return {
    authenticated: hasApiKey || tokens !== null,
    accountLabel: idToken ? jwtEmail(idToken) : null,
  };
}

export const codexAuthenticated = async (home: string) =>
  (await readCodexAccountIdentity(home)).authenticated;

export type ClaudeAccountCredentials = {
  accessToken: string;
  expiresAt: number | null;
  hasRefreshToken: boolean;
  refreshTokenExpiresAt: number | null;
  accountLabel: string | null;
  planType: string | null;
};

/**
 * Claude Code refreshes its access token lazily, so a lapsed token in the
 * credential store only means the usage API cannot be called right now — the
 * login itself is expired only once the refresh token is unusable too.
 */
export type ClaudeTokenState = "usable" | "stale" | "expired";

export function parseClaudeAccountCredentials(
  contents: string,
): ClaudeAccountCredentials | null {
  let oauth: Record<string, unknown> | null = null;
  try {
    oauth = objectOrNull(
      (JSON.parse(contents) as { claudeAiOauth?: unknown }).claudeAiOauth,
    );
  } catch {
    return null;
  }
  if (!oauth) return null;
  const rawToken = typeof oauth.accessToken === "string"
    ? oauth.accessToken
    : typeof oauth.access_token === "string"
      ? oauth.access_token
      : null;
  const accessToken = rawToken?.trim();
  if (!accessToken) return null;
  const refreshToken = typeof oauth.refreshToken === "string"
    ? oauth.refreshToken.trim()
    : "";
  const emailAddress = typeof oauth.emailAddress === "string"
    ? oauth.emailAddress
    : typeof oauth.email_address === "string"
      ? oauth.email_address
      : null;
  const email = typeof oauth.email === "string" ? oauth.email : null;
  const subscription = typeof oauth.subscriptionType === "string"
    ? oauth.subscriptionType
    : typeof oauth.subscription_type === "string"
      ? oauth.subscription_type
      : null;
  return {
    accessToken,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    hasRefreshToken: refreshToken.length > 0,
    refreshTokenExpiresAt: typeof oauth.refreshTokenExpiresAt === "number"
      ? oauth.refreshTokenExpiresAt
      : null,
    accountLabel: (emailAddress ?? email)?.trim() || null,
    planType: subscription?.trim() || null,
  };
}

export function claudeTokenState(
  credentials: ClaudeAccountCredentials,
  now: number,
): ClaudeTokenState {
  const expired = credentials.expiresAt !== null &&
    credentials.expiresAt <= now + CLAUDE_TOKEN_SKEW_MILLIS;
  if (!expired) return "usable";
  const refreshable = credentials.hasRefreshToken &&
    (credentials.refreshTokenExpiresAt === null ||
      credentials.refreshTokenExpiresAt > now);
  return refreshable ? "stale" : "expired";
}

const claudeConfigDirectory = (home: string) =>
  process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");

const readClaudeKeychain = (home: string) => {
  if (process.platform !== "darwin") return null;
  const account = process.env.USER?.trim() || process.env.USERNAME?.trim() ||
    "user";
  const digest = createHash("sha256")
    .update(claudeConfigDirectory(home))
    .digest("hex");
  for (
    const service of [
      `Claude Code-credentials-${digest.slice(0, 8)}`,
      "Claude Code-credentials",
    ]
  ) {
    const result = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
    );
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return null;
};

/**
 * macOS keeps the live credentials in the Keychain, so an abandoned
 * `.credentials.json` must never shadow them.
 */
export async function readClaudeCredentials(
  home: string,
): Promise<ClaudeAccountCredentials | null> {
  const keychain = readClaudeKeychain(home);
  if (keychain) return parseClaudeAccountCredentials(keychain);
  try {
    return parseClaudeAccountCredentials(
      await readFile(join(claudeConfigDirectory(home), ".credentials.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export const parseClaudeAuthStatus = (stdout: string) => {
  try {
    return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
};

export const claudeAuthenticated = async (binary: string) =>
  parseClaudeAuthStatus(
    commandResult(binary, ["auth", "status"], withoutGoogleCredentials()).stdout,
  );

export type GrokAuthSession = {
  accessToken: string;
  userId: string | null;
  expiresAt: number | null;
  accountLabel: string | null;
};

const grokHome = (home: string) =>
  process.env.GROK_HOME?.trim() || join(home, ".grok");

export function parseGrokAuthSession(
  contents: string,
  now: number,
): GrokAuthSession | null {
  let entries: Record<string, unknown>;
  try {
    const parsed = objectOrNull(JSON.parse(contents));
    if (!parsed) return null;
    entries = parsed;
  } catch {
    return null;
  }
  let preferredSeen = false;
  let expiredPreferred: GrokAuthSession | null = null;
  let fallback: GrokAuthSession | null = null;
  for (const [issuer, value] of Object.entries(entries)) {
    const preferred = issuer === "https://auth.x.ai" ||
      issuer.startsWith("https://auth.x.ai::");
    preferredSeen ||= preferred;
    const entry = objectOrNull(value);
    if (!entry) continue;
    const accessToken = typeof entry.key === "string" ? entry.key : "";
    if (!accessToken) continue;
    const rawExpiry = typeof entry.expires_at === "string"
      ? entry.expires_at
      : typeof entry.expiresAt === "string"
        ? entry.expiresAt
        : null;
    const teamId = typeof entry.team_id === "string"
      ? entry.team_id
      : typeof entry.teamId === "string"
        ? entry.teamId
        : null;
    const session: GrokAuthSession = {
      accessToken,
      userId: typeof entry.user_id === "string" && entry.user_id
        ? entry.user_id
        : typeof entry.userId === "string" && entry.userId
          ? entry.userId
          : null,
      expiresAt: rawExpiry ? parseIsoMillis(rawExpiry) : null,
      accountLabel: usableAccountLabel(entry.email) ??
        jwtEmail(accessToken) ??
        usableAccountLabel(teamId),
    };
    if (!preferred) {
      fallback ??= session;
      continue;
    }
    if (
      session.expiresAt === null ||
      session.expiresAt > now + GROK_TOKEN_SKEW_MILLIS
    ) {
      return session;
    }
    expiredPreferred ??= session;
  }
  return expiredPreferred ?? (preferredSeen ? null : fallback);
}

export type GrokAuthLookup =
  | { session: GrokAuthSession; error: null }
  | { session: null; error: string };

export async function readGrokAuthSession(
  home: string,
  now: number,
): Promise<GrokAuthLookup> {
  let contents: string;
  try {
    contents = await readFile(join(grokHome(home), "auth.json"), "utf8");
  } catch (error) {
    return {
      session: null,
      error: error && typeof error === "object" && "code" in error &&
          error.code !== "ENOENT"
        ? "Grok 인증 파일을 읽지 못했습니다."
        : "Grok 로그인이 필요합니다. `grok login`을 실행하세요.",
    };
  }
  const session = parseGrokAuthSession(contents, now);
  return session
    ? { session, error: null }
    : { session: null, error: "Grok 로그인이 필요합니다. `grok login`을 실행하세요." };
}

export const grokAuthenticated = async (home: string, now: number) => {
  const { session } = await readGrokAuthSession(home, now);
  return Boolean(
    session &&
      (session.expiresAt === null ||
        session.expiresAt > now + GROK_TOKEN_SKEW_MILLIS),
  );
};

export type GeminiOauthAccess = {
  accessToken: string;
  email: string | null;
};

const geminiCredentialPath = (home: string) =>
  process.env.GEMINI_OAUTH_CREDS?.trim() ||
  join(home, ".gemini", "oauth_creds.json");

export function parseGeminiOauthAccess(
  contents: string,
  now: number,
): GeminiOauthAccess | null {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = objectOrNull(JSON.parse(contents));
  } catch {
    return null;
  }
  if (!parsed) return null;
  const accessToken = typeof parsed.access_token === "string"
    ? parsed.access_token.trim()
    : "";
  if (!accessToken) return null;
  if (typeof parsed.expiry_date === "number" && parsed.expiry_date <= now) {
    return null;
  }
  return { accessToken, email: usableAccountLabel(parsed.email) };
}

export async function readGeminiOauthAccess(
  home: string,
  now: number,
): Promise<GeminiOauthAccess | null> {
  try {
    return parseGeminiOauthAccess(
      await readFile(geminiCredentialPath(home), "utf8"),
      now,
    );
  } catch {
    return null;
  }
}

/** The stored Antigravity email, even when its access token already lapsed. */
export async function readGeminiOauthEmail(home: string) {
  const parsed = objectOrNull(await readJsonFile(geminiCredentialPath(home)));
  return parsed ? usableAccountLabel(parsed.email) : null;
}

export const agyAuthenticated = async (binary: string) => {
  const result = commandResult(
    binary,
    ["--output-format", "json", "models"],
    withoutGoogleCredentials(),
  );
  return result.status === 0 && !result.error;
};

const opencodeAuthPaths = (home: string) => {
  const paths = [
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ];
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) paths.unshift(join(xdg, "opencode", "auth.json"));
  const appData = process.env.APPDATA?.trim();
  if (appData) paths.unshift(join(appData, "opencode", "auth.json"));
  return paths;
};

const collectAccountLabel = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const label = collectAccountLabel(item);
      if (label) return label;
    }
    return null;
  }
  const record = objectOrNull(value);
  if (!record) return null;
  for (const key of ["email", "emailAddress", "account", "user"]) {
    const candidate = record[key];
    const label = typeof candidate === "string"
      ? usableAccountLabel(candidate)
      : collectAccountLabel(candidate);
    if (label) return label;
  }
  for (const candidate of Object.values(record)) {
    const label = collectAccountLabel(candidate);
    if (label) return label;
  }
  return null;
};

export const parseOpencodeAuthLabel = (contents: string) => {
  try {
    return collectAccountLabel(JSON.parse(contents));
  } catch {
    return null;
  }
};

export async function readOpencodeAccountIdentity(
  home: string,
  installed: boolean,
): Promise<ProviderAccountIdentity> {
  for (const path of opencodeAuthPaths(home)) {
    const parsed = objectOrNull(await readJsonFile(path));
    if (!parsed) continue;
    const label = collectAccountLabel(parsed);
    if (label) return { authenticated: true, accountLabel: label };
    if (Object.keys(parsed).length > 0) {
      return { authenticated: true, accountLabel: null };
    }
  }
  return { authenticated: installed, accountLabel: null };
}

export const opencodeAuthenticated = async (home: string) => {
  for (const path of opencodeAuthPaths(home)) {
    const parsed = objectOrNull(await readJsonFile(path));
    if (parsed && Object.keys(parsed).length > 0) return true;
  }
  return false;
};

export const parseCursorAboutEmail = (stdout: string) => {
  try {
    return usableAccountLabel(
      (JSON.parse(stdout) as { userEmail?: unknown }).userEmail,
    );
  } catch {
    const line = stdout
      .split(/\r?\n/u)
      .find((candidate) => candidate.trimStart().startsWith("User Email"));
    return line
      ? usableAccountLabel(line.trimStart().slice("User Email".length))
      : null;
  }
};

export function readCursorAccountIdentity(
  binary: string,
): ProviderAccountIdentity {
  for (const args of [["about", "--format", "json"], ["about"]]) {
    const result = commandResult(binary, args);
    if (result.status !== 0 || result.error) continue;
    const email = parseCursorAboutEmail(result.stdout);
    if (email) return { authenticated: true, accountLabel: email };
  }
  return unauthenticated;
}

export const cursorAuthenticated = async (binary: string) =>
  Boolean(process.env.CURSOR_API_KEY?.trim()) ||
  readCursorAccountIdentity(binary).authenticated;
