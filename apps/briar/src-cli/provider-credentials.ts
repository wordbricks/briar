import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/**
 * Claude Code's own OAuth client, so a token Briar refreshes stays the token
 * Claude Code reads back out of the same store.
 */
const CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_REFRESH_TIMEOUT_MS = 10_000;
/** A crashed refresh must not lock every later one out of the store. */
const CLAUDE_REFRESH_LOCK_STALE_MS = 30_000;

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

/**
 * Where a Claude login was read from, so a refreshed token is written back to
 * the same place Claude Code will read it from next.
 */
export type ClaudeCredentialStore =
  | { kind: "keychain"; service: string; account: string }
  | { kind: "file"; path: string };

export type ClaudeAccountCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  hasRefreshToken: boolean;
  refreshTokenExpiresAt: number | null;
  accountLabel: string | null;
  planType: string | null;
  /** The stored document, so a refresh rewrites it without dropping fields. */
  document: Record<string, unknown>;
  store: ClaudeCredentialStore | null;
};

/**
 * Claude Code refreshes its access token lazily, so a lapsed token in the
 * credential store only means the usage API cannot be called right now — the
 * login itself is expired only once the refresh token is unusable too.
 */
export type ClaudeTokenState = "usable" | "stale" | "expired";

export function parseClaudeAccountCredentials(
  contents: string,
  store: ClaudeCredentialStore | null = null,
): ClaudeAccountCredentials | null {
  let document: Record<string, unknown> | null = null;
  let oauth: Record<string, unknown> | null = null;
  try {
    document = objectOrNull(JSON.parse(contents));
    oauth = objectOrNull(document?.claudeAiOauth);
  } catch {
    return null;
  }
  if (!document || !oauth) return null;
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
    refreshToken,
    expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    hasRefreshToken: refreshToken.length > 0,
    refreshTokenExpiresAt: typeof oauth.refreshTokenExpiresAt === "number"
      ? oauth.refreshTokenExpiresAt
      : null,
    accountLabel: (emailAddress ?? email)?.trim() || null,
    planType: subscription?.trim() || null,
    document,
    store,
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

const claudeKeychainAccount = () =>
  process.env.USER?.trim() || process.env.USERNAME?.trim() || "user";

const readClaudeKeychain = (home: string) => {
  if (process.platform !== "darwin") return null;
  const account = claudeKeychainAccount();
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
    if (result.status === 0 && result.stdout.trim()) {
      return { store: { kind: "keychain" as const, service, account }, contents: result.stdout.trim() };
    }
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
  if (keychain) {
    return parseClaudeAccountCredentials(keychain.contents, keychain.store);
  }
  const path = join(claudeConfigDirectory(home), ".credentials.json");
  try {
    return parseClaudeAccountCredentials(await readFile(path, "utf8"), {
      kind: "file",
      path,
    });
  } catch {
    return null;
  }
}

/** Re-read one store directly, so a refresh can see a concurrent rotation. */
const readClaudeStore = async (
  store: ClaudeCredentialStore,
): Promise<ClaudeAccountCredentials | null> => {
  if (store.kind === "file") {
    try {
      return parseClaudeAccountCredentials(await readFile(store.path, "utf8"), store);
    } catch {
      return null;
    }
  }
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", store.service, "-a", store.account, "-w"],
    { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
  );
  return result.status === 0 && result.stdout.trim()
    ? parseClaudeAccountCredentials(result.stdout.trim(), store)
    : null;
};

const writeClaudeStore = (store: ClaudeCredentialStore, contents: string) => {
  if (store.kind === "file") {
    try {
      writeFileSync(store.path, contents, { encoding: "utf8", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-s",
      store.service,
      "-a",
      store.account,
      "-w",
      contents,
    ],
    { encoding: "utf8", timeout: KEYCHAIN_TIMEOUT_MS },
  );
  return result.status === 0;
};

const claudeStoreKey = (store: ClaudeCredentialStore) =>
  store.kind === "file" ? `file:${store.path}` : `keychain:${store.service}:${store.account}`;

/**
 * Only one process may exchange a given refresh token: the provider retires
 * the old one, so two concurrent exchanges can leave Claude Code holding a
 * dead token and force the user to sign in again.
 */
const acquireClaudeRefreshLock = (store: ClaudeCredentialStore) => {
  const digest = createHash("sha256").update(claudeStoreKey(store)).digest("hex");
  const path = join(tmpdir(), `briar-claude-refresh-${digest.slice(0, 16)}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      closeSync(openSync(path, "wx"));
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // The lock is advisory; a failed cleanup is reclaimed as stale.
        }
      };
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs <= CLAUDE_REFRESH_LOCK_STALE_MS) {
          return null;
        }
        unlinkSync(path);
      } catch {
        return null;
      }
    }
  }
  return null;
};

type ClaudeRefreshedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  refreshTokenExpiresAt: number | null;
  scopes: string[] | null;
};

const secondsFromNow = (value: unknown, now: number) =>
  typeof value === "number" && Number.isFinite(value) ? now + value * 1_000 : null;

export function parseClaudeRefreshResponse(
  body: unknown,
  now: number,
  previousRefreshToken: string,
): ClaudeRefreshedTokens | null {
  const payload = objectOrNull(body);
  const accessToken = typeof payload?.access_token === "string"
    ? payload.access_token.trim()
    : "";
  if (!accessToken) return null;
  const rotated = typeof payload?.refresh_token === "string"
    ? payload.refresh_token.trim()
    : "";
  const scope = typeof payload?.scope === "string" ? payload.scope.trim() : "";
  return {
    accessToken,
    // A provider that does not rotate returns no refresh token at all.
    refreshToken: rotated || previousRefreshToken,
    expiresAt: secondsFromNow(payload?.expires_in, now),
    refreshTokenExpiresAt: secondsFromNow(payload?.refresh_token_expires_in, now),
    scopes: scope ? scope.split(" ").filter(Boolean) : null,
  };
}

/** The stored document with the refreshed tokens merged into it. */
export function claudeDocumentWithTokens(
  document: Record<string, unknown>,
  tokens: ClaudeRefreshedTokens,
) {
  const oauth = objectOrNull(document.claudeAiOauth) ?? {};
  return {
    ...document,
    claudeAiOauth: {
      ...oauth,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      ...(tokens.expiresAt === null ? {} : { expiresAt: tokens.expiresAt }),
      ...(tokens.refreshTokenExpiresAt === null
        ? {}
        : { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt }),
      ...(tokens.scopes === null ? {} : { scopes: tokens.scopes }),
    },
  };
}

export type ClaudeRefreshOptions = {
  now: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
};

/**
 * Trade a lapsed Claude access token for a fresh one and write it back to the
 * store Claude Code reads. Returns null whenever the exchange cannot be made
 * safely, so the caller keeps reporting the login it already read instead of
 * risking the stored token.
 */
export async function refreshClaudeAccessToken(
  credentials: ClaudeAccountCredentials,
  options: Partial<ClaudeRefreshOptions> = {},
): Promise<ClaudeAccountCredentials | null> {
  const { store, refreshToken } = credentials;
  if (!store || !refreshToken) return null;
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CLAUDE_REFRESH_TIMEOUT_MS;
  const release = acquireClaudeRefreshLock(store);
  if (!release) return null;
  try {
    // The exchange retires the stored refresh token, so a store Briar cannot
    // write is never exchanged — that would sign Claude Code out.
    if (!writeClaudeStore(store, JSON.stringify(credentials.document))) {
      return null;
    }
    const response = await fetchImpl(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const tokens = parseClaudeRefreshResponse(
      await response.json(),
      now,
      refreshToken,
    );
    if (!tokens) return null;
    // Claude Code may have refreshed while the exchange was in flight; its
    // token is the live one, so the store is left exactly as it left it.
    const current = await readClaudeStore(store);
    if (current && current.refreshToken !== refreshToken) return current;
    const document = claudeDocumentWithTokens(credentials.document, tokens);
    if (!writeClaudeStore(store, JSON.stringify(document))) return null;
    return parseClaudeAccountCredentials(JSON.stringify(document), store);
  } catch {
    return null;
  } finally {
    release();
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

/**
 * Provider keys pi reads straight from the environment. Pi is multi-provider:
 * any one of these lets it run a turn without a stored credential, which is
 * why an empty `auth.json` is not by itself a signed-out Pi.
 */
export const PI_PROVIDER_KEY_ENVIRONMENT_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
] as const;

/**
 * Pi is authenticated when `/login` has written a credential to
 * `~/.pi/agent/auth.json`, or when a provider key is present in the
 * environment.
 */
export const piAuthenticated = async (
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  if (
    PI_PROVIDER_KEY_ENVIRONMENT_KEYS.some((key) =>
      Boolean(environment[key]?.trim())
    )
  ) {
    return true;
  }
  const parsed = objectOrNull(
    await readJsonFile(join(home, ".pi", "agent", "auth.json")),
  );
  return Boolean(parsed && Object.keys(parsed).length > 0);
};

/** OpenCode stores the paid Go plan key under the `opencode-go` entry. */
export const parseOpencodeGoKey = (contents: string): string | null => {
  try {
    const parsed = objectOrNull(JSON.parse(contents));
    const entry = objectOrNull(parsed?.["opencode-go"]);
    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
    return key || null;
  } catch {
    return null;
  }
};

export async function readOpencodeGoKey(home: string): Promise<string | null> {
  for (const path of opencodeAuthPaths(home)) {
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const key = parseOpencodeGoKey(contents);
    if (key) return key;
  }
  return null;
}

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
