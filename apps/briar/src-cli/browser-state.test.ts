import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSharedState,
  defaultSharedStatePath,
  ensureSharedState,
  mergeSharedState,
  mergeStates,
  sharedStatePath,
} from "./browser-state";

const directories: string[] = [];

const workspace = async () => {
  const directory = await mkdtemp(join(tmpdir(), "briar-browser-state-"));
  directories.push(directory);
  return {
    directory,
    statePath: join(directory, "share", "agent-browser", "shared-state.json"),
  };
};

const writeInput = async (directory: string, name: string, contents: unknown) => {
  const path = join(directory, name);
  await writeFile(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents),
    "utf8",
  );
  return path;
};

const cookie = (
  overrides: Partial<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
  }> = {},
) => ({
  name: "session",
  value: "one",
  domain: "example.com",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  ...overrides,
});

const readState = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as {
    cookies: { name: string; value: string; domain: string; path: string }[];
    origins: {
      origin: string;
      localStorage: { name: string; value: string }[];
    }[];
  };

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("sharedStatePath", () => {
  it("prefers an explicit path, then the environment, then the home default", () => {
    expect(
      sharedStatePath({
        path: "/explicit/state.json",
        environment: { BRIAR_AGENT_BROWSER_STATE_FILE: "/from/env.json" },
        home: "/Users/dev",
      }),
    ).toBe("/explicit/state.json");
    expect(
      sharedStatePath({
        environment: { BRIAR_AGENT_BROWSER_STATE_FILE: "/from/env.json" },
        home: "/Users/dev",
      }),
    ).toBe("/from/env.json");
    expect(sharedStatePath({ environment: {}, home: "/Users/dev" })).toBe(
      "/Users/dev/.local/share/briar/agent-browser/shared-state.json",
    );
    expect(defaultSharedStatePath("/Users/dev")).toBe(
      "/Users/dev/.local/share/briar/agent-browser/shared-state.json",
    );
  });

  it("rejects a relative environment override", () => {
    expect(() =>
      sharedStatePath({
        environment: { BRIAR_AGENT_BROWSER_STATE_FILE: "state.json" },
        home: "/Users/dev",
      }),
    ).toThrow("BRIAR_AGENT_BROWSER_STATE_FILE must be an absolute path");
  });
});

describe("ensureSharedState", () => {
  it("creates an empty private state file inside a private directory", async () => {
    const { statePath } = await workspace();

    const summary = await ensureSharedState({ path: statePath });

    expect(summary).toEqual({ path: statePath, cookies: 0, origins: 0 });
    expect(await readState(statePath)).toEqual({ cookies: [], origins: [] });
    expect(await modeOf(statePath)).toBe(0o600);
    expect(await modeOf(dirname(statePath))).toBe(0o700);
  });

  it("keeps an existing state file and reports what it holds", async () => {
    const { directory, statePath } = await workspace();
    await ensureSharedState({ path: statePath });
    const input = await writeInput(directory, "saved.json", {
      cookies: [cookie()],
      origins: [{ origin: "https://example.com", localStorage: [{ name: "a", value: "1" }] }],
    });
    await mergeSharedState(input, { path: statePath });
    const before = await readFile(statePath, "utf8");

    const summary = await ensureSharedState({ path: statePath });

    expect(summary).toEqual({ path: statePath, cookies: 1, origins: 1 });
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  it("uses the environment override when no explicit path is given", async () => {
    const { statePath } = await workspace();
    vi.stubEnv("BRIAR_AGENT_BROWSER_STATE_FILE", statePath);

    const summary = await ensureSharedState();

    expect(summary.path).toBe(statePath);
    expect(await readState(statePath)).toEqual({ cookies: [], origins: [] });
  });
});

describe("mergeSharedState", () => {
  it("adds new cookies and lets the incoming side win on the same key", async () => {
    const { directory, statePath } = await workspace();
    const first = await writeInput(directory, "first.json", {
      cookies: [cookie(), cookie({ name: "other", domain: "other.example" })],
      origins: [],
    });
    const second = await writeInput(directory, "second.json", {
      cookies: [
        cookie({ value: "two" }),
        cookie({ name: "session", path: "/admin", value: "scoped" }),
      ],
      origins: [],
    });

    const firstSummary = await mergeSharedState(first, { path: statePath });
    const secondSummary = await mergeSharedState(second, { path: statePath });

    expect(firstSummary).toEqual({
      path: statePath,
      cookies: 2,
      origins: 0,
      added: 2,
      replaced: 0,
      expired: 0,
    });
    expect(secondSummary).toEqual({
      path: statePath,
      cookies: 3,
      origins: 0,
      added: 1,
      replaced: 1,
      expired: 0,
    });
    const state = await readState(statePath);
    expect(
      state.cookies.map(({ name, domain, path, value }) => ({ name, domain, path, value })),
    ).toEqual([
      { name: "session", domain: "example.com", path: "/", value: "two" },
      { name: "other", domain: "other.example", path: "/", value: "one" },
      { name: "session", domain: "example.com", path: "/admin", value: "scoped" },
    ]);
  });

  it("drops expired cookies from both sides and keeps session cookies", async () => {
    const { directory, statePath } = await workspace();
    const now = Date.UTC(2026, 0, 2);
    const stale = await writeInput(directory, "stale.json", {
      cookies: [
        cookie({ name: "stale", expires: now / 1_000 + 60 }),
        cookie({ name: "session-cookie", expires: -1 }),
        cookie({ name: "no-expiry-cookie", expires: 0 }),
      ],
      origins: [],
    });
    await mergeSharedState(stale, { path: statePath, now: () => now });

    const incoming = await writeInput(directory, "incoming.json", {
      cookies: [
        cookie({ name: "fresh", expires: now / 1_000 + 7_200 }),
        cookie({ name: "already-gone", expires: now / 1_000 - 10 }),
      ],
      origins: [],
    });
    const summary = await mergeSharedState(incoming, {
      path: statePath,
      now: () => now + 3_600_000,
    });

    expect(summary).toMatchObject({ cookies: 3, added: 1, replaced: 0, expired: 2 });
    expect((await readState(statePath)).cookies.map((entry) => entry.name)).toEqual([
      "session-cookie",
      "no-expiry-cookie",
      "fresh",
    ]);
  });

  it("merges origins by origin and local storage items by name", async () => {
    const { directory, statePath } = await workspace();
    const first = await writeInput(directory, "first.json", {
      cookies: [],
      origins: [
        {
          origin: "https://example.com",
          localStorage: [
            { name: "token", value: "old" },
            { name: "theme", value: "dark" },
          ],
        },
      ],
    });
    const second = await writeInput(directory, "second.json", {
      cookies: [],
      origins: [
        { origin: "https://example.com", localStorage: [{ name: "token", value: "new" }] },
        { origin: "https://other.example", localStorage: [{ name: "id", value: "9" }] },
      ],
    });

    await mergeSharedState(first, { path: statePath });
    const summary = await mergeSharedState(second, { path: statePath });

    expect(summary.origins).toBe(2);
    expect((await readState(statePath)).origins).toEqual([
      {
        origin: "https://example.com",
        localStorage: [
          { name: "token", value: "new" },
          { name: "theme", value: "dark" },
        ],
      },
      { origin: "https://other.example", localStorage: [{ name: "id", value: "9" }] },
    ]);
  });

  it("tolerates missing optional fields and unknown extra fields", async () => {
    const { directory, statePath } = await workspace();
    const input = await writeInput(directory, "loose.json", {
      cookies: [{ name: "a", value: "1", domain: "example.com", partitionKey: "x" }],
      origins: [{ origin: "https://example.com" }],
      cookieCount: 1,
    });

    const summary = await mergeSharedState(input, { path: statePath });

    expect(summary).toMatchObject({ cookies: 1, origins: 1, added: 1 });
    expect((await readState(statePath)).cookies[0]).toEqual({
      name: "a",
      value: "1",
      domain: "example.com",
      path: "/",
    });
  });

  it("rejects a malformed input and leaves the shared state untouched", async () => {
    const { directory, statePath } = await workspace();
    const valid = await writeInput(directory, "valid.json", {
      cookies: [cookie()],
      origins: [],
    });
    await mergeSharedState(valid, { path: statePath });
    const before = await readFile(statePath, "utf8");

    await expect(
      mergeSharedState(await writeInput(directory, "shape.json", { cookies: [{ name: 1 }] }), {
        path: statePath,
      }),
    ).rejects.toThrow("is not a Playwright storage state file");
    await expect(
      mergeSharedState(await writeInput(directory, "broken.json", "not json"), {
        path: statePath,
      }),
    ).rejects.toThrow("is not a Playwright storage state file");

    expect(await readFile(statePath, "utf8")).toBe(before);
    expect(await readdir(dirname(statePath))).toEqual(["shared-state.json"]);
  });

  it("waits for a lock another process holds", async () => {
    const { directory, statePath } = await workspace();
    const input = await writeInput(directory, "saved.json", { cookies: [cookie()], origins: [] });
    await ensureSharedState({ path: statePath });
    const lockPath = `${statePath}.lock`;
    await mkdir(lockPath);
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length >= 2) await rm(lockPath, { recursive: true, force: true });
    });

    const summary = await mergeSharedState(input, { path: statePath, sleep });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(summary.added).toBe(1);
    expect(await readdir(dirname(statePath))).toEqual(["shared-state.json"]);
  });

  it("takes over a lock left behind by a dead process", async () => {
    const { directory, statePath } = await workspace();
    const input = await writeInput(directory, "saved.json", { cookies: [cookie()], origins: [] });
    await ensureSharedState({ path: statePath });
    const lockPath = `${statePath}.lock`;
    await mkdir(lockPath);
    const abandoned = new Date(Date.now() - 120_000);
    await utimes(lockPath, abandoned, abandoned);
    const sleep = vi.fn(async () => {
      throw new Error("a stale lock must not be waited on");
    });

    const summary = await mergeSharedState(input, { path: statePath, sleep });

    expect(sleep).not.toHaveBeenCalled();
    expect(summary.added).toBe(1);
    expect(await readdir(dirname(statePath))).toEqual(["shared-state.json"]);
  });

  it("gives up once the lock has been held past the retry budget", async () => {
    const { directory, statePath } = await workspace();
    const input = await writeInput(directory, "saved.json", { cookies: [cookie()], origins: [] });
    await ensureSharedState({ path: statePath });
    await mkdir(`${statePath}.lock`);
    let clock = Date.now();

    await expect(
      mergeSharedState(input, {
        path: statePath,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toThrow("Timed out waiting for the shared agent-browser state lock");
    expect(await readState(statePath)).toEqual({ cookies: [], origins: [] });
  });
});

describe("mergeStates", () => {
  it("counts cookies dropped for expiry on both sides", () => {
    const now = Date.UTC(2026, 0, 2);
    const merged = mergeStates(
      { cookies: [cookie({ name: "old", expires: now / 1_000 - 1 })], origins: [] },
      { cookies: [cookie({ name: "gone", expires: now / 1_000 - 1 })], origins: [] },
      now,
    );

    expect(merged).toEqual({
      state: { cookies: [], origins: [] },
      added: 0,
      replaced: 0,
      expired: 2,
    });
  });
});

describe("clearSharedState", () => {
  it("resets the shared state to empty", async () => {
    const { directory, statePath } = await workspace();
    const input = await writeInput(directory, "saved.json", {
      cookies: [cookie()],
      origins: [{ origin: "https://example.com", localStorage: [{ name: "a", value: "1" }] }],
    });
    await mergeSharedState(input, { path: statePath });

    const summary = await clearSharedState({ path: statePath });

    expect(summary).toEqual({ path: statePath, cookies: 0, origins: 0 });
    expect(await readState(statePath)).toEqual({ cookies: [], origins: [] });
    expect(await modeOf(statePath)).toBe(0o600);
    expect(await readdir(dirname(statePath))).toEqual(["shared-state.json"]);
  });
});
