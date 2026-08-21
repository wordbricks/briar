import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import imagePolicy from "../config/merge-group-ci-image.json";
import {
  MERGE_GROUP_CI_CONTEXTS,
  MERGE_GROUP_CI_IMAGE_REPOSITORY,
  MERGE_GROUP_CI_MAX_DEADLINE_MS,
  MERGE_GROUP_CI_MAX_OUTPUT_BYTES,
  MERGE_GROUP_CI_PHASES,
} from "../src/lib/merge-group-validation-contract";
import {
  assertTrustedCandidateConfiguration,
  disposeExactShaValidation,
  ExactShaValidationInputError,
  type GitRunner,
  isMergeGroupCiControlPath,
  isAuditedMergeGroupImagePolicy,
  mergeGroupDockerArguments,
  MergeGroupCiDefinitionChangedError,
  MergeGroupCiInfrastructureError,
  prepareExactShaValidation,
  type PreparedExactShaValidation,
  resolveMergeGroupContainerRuntime,
  runFixedMergeGroupValidation,
  terminateProcessGroup,
} from "./merge-group-validation";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const sourceRef =
  "refs/briar/merge-group-validation/11111111-1111-4111-8111-111111111111";
const protectedBaseRef =
  "refs/briar/merge-group-validation-base/11111111-1111-4111-8111-111111111111";
const image = `${MERGE_GROUP_CI_IMAGE_REPOSITORY}@sha256:${"c".repeat(64)}`;
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function preparedFixture(): Promise<PreparedExactShaValidation> {
  const root = await mkdtemp(join(tmpdir(), "briar-merge-group-ci."));
  roots.push(root);
  const paths = {
    bundlePath: join(root, "repository.bundle"),
    profilePath: join(root, "ci-merge-group.sh"),
    localProfilePath: join(root, "ci-local.sh"),
    bunConfigPath: join(root, "bunfig.toml"),
  };
  await Promise.all(Object.values(paths).map((path) => writeFile(path, "fixture\n")));
  return {
    executionId: "11111111-1111-4111-8111-111111111111",
    baseSha,
    headSha,
    root,
    ...paths,
  };
}

async function fakeDocker(scriptBody: string) {
  const root = await mkdtemp(join(tmpdir(), "briar-fake-docker."));
  roots.push(root);
  const executable = join(root, "docker");
  await writeFile(executable, `#!/bin/bash
set -u
if [[ "\${1:-}" == "rm" ]]; then exit 0; fi
if [[ "\${1:-}" == "container" && "\${2:-}" == "inspect" ]]; then exit 1; fi
for argument in "$@"; do
  case "$argument" in
    --cidfile=*) printf '%s' "$$" >"\${argument#*=}" ;;
  esac
done
context="\${@: -2:1}"
phase="\${@: -1}"
${scriptBody}
`);
  await chmod(executable, 0o700);
  return { root, executable };
}

describe("exact-SHA merge-group foundation", () => {
  it("keeps the image policy unpublished and disabled by default", () => {
    expect(imagePolicy).toMatchObject({
      protocol: 1,
      repository: MERGE_GROUP_CI_IMAGE_REPOSITORY,
      manifestDigest: null,
      verification: {
        independentBuilds: 0,
        matchingManifestDigests: false,
      },
      rollout: { published: false, enabled: false },
    });
    expect(resolveMergeGroupContainerRuntime(
      () => "/usr/bin/docker",
      () => true,
    )).toMatchObject({ ready: false });
  });

  it("binds runtime readiness to the independently audited digest", () => {
    const auditedDigest = `sha256:${"c".repeat(64)}`;
    const enabledPolicy = {
      schemaVersion: 1,
      protocol: 1,
      repository: MERGE_GROUP_CI_IMAGE_REPOSITORY,
      manifestDigest: auditedDigest,
      platforms: ["linux/arm64"],
      verification: {
        independentBuilds: 2,
        matchingManifestDigests: true,
        verifiedAt: "2026-08-21T00:00:00.000Z",
      },
      rollout: { published: true, enabled: true },
    };
    expect(isAuditedMergeGroupImagePolicy(enabledPolicy, auditedDigest)).toBe(true);
    expect(isAuditedMergeGroupImagePolicy(
      { ...enabledPolicy, manifestDigest: `sha256:${"d".repeat(64)}` },
      auditedDigest,
    )).toBe(false);
    expect(isAuditedMergeGroupImagePolicy({
      ...enabledPolicy,
      verification: { ...enabledPolicy.verification, independentBuilds: 2.5 },
    }, auditedDigest)).toBe(false);
    const inspect = vi.fn(() => true);
    expect(resolveMergeGroupContainerRuntime(
      () => "/usr/bin/docker",
      inspect,
    )).toMatchObject({ ready: false });
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each([
    "scripts/ci-local.sh",
    "scripts/d1-test-template.ts",
    "worker/src/test-helpers/d1.ts",
    "src/test/setup.ts",
    "config/merge-group-vitest.config.ts",
    "vitest.config.ts",
    "nested/vite.config.mts",
    ".postcssrc.cjs",
    "web/.postcssrc.ts",
    ".babelrc.mjs",
    "bunfig.toml",
    ".env.test",
    ".dev.vars.local",
    ".cargo/config.toml",
    "src-tauri/.cargo/config.toml",
    ".gitleaksignore",
    "src-tauri/build.rs",
    "src-tauri/Cargo.toml",
    "tools/preload.ts",
    "node_modules/vitest/index.js",
  ])("rejects candidate-controlled CI path %s", (path) => {
    expect(isMergeGroupCiControlPath(path)).toBe(true);
    expect(() => assertTrustedCandidateConfiguration([path])).toThrow(
      MergeGroupCiDefinitionChangedError,
    );
  });

  it("allows ordinary application and test source changes", () => {
    expect(() => assertTrustedCandidateConfiguration([
      "src/components/QueuePanel.tsx",
      "src/components/QueuePanel.test.tsx",
      "worker/src/queue.ts",
      "src-tauri/src/lib.rs",
    ])).not.toThrow();
  });

  it("keeps every fixed phase in the trusted wrapper and out of candidate-writable PATH", async () => {
    const wrapper = await readFile("scripts/ci-merge-group.sh", "utf8");
    for (const context of MERGE_GROUP_CI_CONTEXTS) {
      for (const phase of MERGE_GROUP_CI_PHASES[context]) {
        expect(wrapper).toContain(`${context}:${phase}`);
      }
    }
    expect(wrapper).toContain("PATH=/opt/briar/trusted-bin:");
    expect(wrapper).not.toContain("/scratch/bin");
    expect(wrapper).toContain("rustup run 1.96.0 rustc --version");
    expect(wrapper).not.toContain("rustup toolchain install");
  });

  it("rejects an executable auto-config before trusted files or a bundle are read", async () => {
    const operations: string[] = [];
    const git: GitRunner = (args) => {
      const operation = args[1];
      operations.push(operation);
      if (operation === "rev-parse") {
        return {
          exitCode: 0,
          stdout: args.at(-1) === `${protectedBaseRef}^{commit}`
            ? `${baseSha}\n`
            : `${headSha}\n`,
          stderr: "",
        };
      }
      if (operation === "diff") {
        return { exitCode: 0, stdout: ".postcssrc.cjs\0", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await expect(prepareExactShaValidation(git, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef,
      baseSha,
      headSha,
    })).rejects.toBeInstanceOf(MergeGroupCiDefinitionChangedError);
    expect(operations).not.toContain("show");
    expect(operations).not.toContain("bundle");
  });

  it("verifies an exact local ref and creates a credential-free bundle", async () => {
    const calls: Array<{
      args: string[];
      options: Parameters<GitRunner>[1];
    }> = [];
    const git: GitRunner = (args, options) => {
      calls.push({ args, options });
      const operation = args[1];
      if (operation === "rev-parse") {
        return {
          exitCode: 0,
          stdout: args.at(-1) === `${protectedBaseRef}^{commit}`
            ? `${baseSha}\n`
            : `${headSha}\n`,
          stderr: "",
        };
      }
      if (operation === "diff") {
        return { exitCode: 0, stdout: "src/app.ts\0", stderr: "" };
      }
      if (operation === "show") {
        return { exitCode: 0, stdout: "trusted base file\n", stderr: "" };
      }
      if (operation === "bundle" && args[2] === "create") {
        writeFileSync(args[3], "bundle");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (operation === "bundle" && args[2] === "list-heads") {
        return {
          exitCode: 0,
          stdout: `${headSha} ${sourceRef}\n`,
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const prepared = await prepareExactShaValidation(git, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef,
      baseSha,
      headSha,
    });
    expect(calls.map((call) => call.args)).toContainEqual([
      "--no-replace-objects",
      "fetch",
      "--no-tags",
      "--force",
      "/repo",
      `+${protectedBaseRef}:${protectedBaseRef}`,
      `+${sourceRef}:${sourceRef}`,
    ]);
    expect(calls.map((call) => call.args)).toContainEqual([
      "--no-replace-objects",
      "fsck",
      "--strict",
      "--no-dangling",
    ]);
    expect(calls.map((call) => call.args)).toContainEqual([
      "--no-replace-objects",
      "rev-parse",
      "--verify",
      `${protectedBaseRef}^{commit}`,
    ]);
    expect(calls.map((call) => call.args)).toContainEqual([
      "--no-replace-objects",
      "merge-base",
      "--is-ancestor",
      baseSha,
      headSha,
    ]);
    expect(calls.map((call) => call.args)).toContainEqual([
      "--no-replace-objects",
      "bundle",
      "create",
      prepared.bundlePath,
      sourceRef,
    ]);
    expect(calls.flatMap((call) => call.args).join(" ")).not.toMatch(
      /token|authorization/iu,
    );
    for (const call of calls) {
      expect(call.options.env).toMatchObject({
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
      });
      expect(call.options.env).not.toHaveProperty("GH_TOKEN");
      expect(call.options.cwd).not.toBe("/repo");
    }
    expect((await stat(prepared.root)).mode & 0o777).toBe(0o700);
    expect((await stat(prepared.bundlePath)).mode & 0o777).toBe(0o444);
    expect((await stat(prepared.profilePath)).mode & 0o777).toBe(0o555);
    expect(await readFile(prepared.profilePath, "utf8")).toContain("trusted base");
    await disposeExactShaValidation(prepared);
    expect(existsSync(prepared.root)).toBe(false);
  });

  it("rejects malformed, moved, and non-descendant exact-SHA input", async () => {
    const never = vi.fn(() => ({ exitCode: 0, stdout: "", stderr: "" }));
    await expect(prepareExactShaValidation(never, "/repo", {
      executionId: "bad/id",
      sourceRef,
      protectedBaseRef,
      baseSha,
      headSha,
    })).rejects.toBeInstanceOf(ExactShaValidationInputError);
    expect(never).not.toHaveBeenCalled();

    await expect(prepareExactShaValidation(never, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef: "refs/heads/main",
      baseSha,
      headSha,
    })).rejects.toThrow(/private ref bound to this execution/iu);
    expect(never).not.toHaveBeenCalled();

    const moved = (args: string[]) => {
      if (args[1] !== "rev-parse") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: args.at(-1) === `${protectedBaseRef}^{commit}`
          ? `${baseSha}\n`
          : `${"d".repeat(40)}\n`,
        stderr: "",
      };
    };
    await expect(prepareExactShaValidation(moved, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef,
      baseSha,
      headSha,
    })).rejects.toThrow(/exact SHA/iu);

    const nonAncestor = (args: string[]) => {
      if (args[1] === "rev-parse") {
        return {
          exitCode: 0,
          stdout: args.at(-1) === `${protectedBaseRef}^{commit}`
            ? `${baseSha}\n`
            : `${headSha}\n`,
          stderr: "",
        };
      }
      if (args[1] === "merge-base") {
        return { exitCode: 1, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    await expect(prepareExactShaValidation(nonAncestor, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef,
      baseSha,
      headSha,
    })).rejects.toThrow(/descend/iu);

    const neverSelfBase = vi.fn(() => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    await expect(prepareExactShaValidation(neverSelfBase, "/repo", {
      executionId: "11111111-1111-4111-8111-111111111111",
      sourceRef,
      protectedBaseRef,
      baseSha: headSha,
      headSha,
    })).rejects.toThrow(/must be distinct/iu);
    expect(neverSelfBase).not.toHaveBeenCalled();
  });

  it("builds a fixed, credential-free, resource-bounded Docker invocation", async () => {
    const prepared = await preparedFixture();
    const args = mergeGroupDockerArguments({
      prepared,
      runtime: { executable: "/usr/bin/docker", image },
      context: "app-worker",
      phase: "app-check",
      containerName: "briar-merge-group-run-app-worker-abc123",
      cidFile: join(prepared.root, "container.cid"),
      deadlineSeconds: 60,
      deadlineUnix: 1_787_270_400,
    });
    expect(args).toEqual(expect.arrayContaining([
      "--rm",
      "--init",
      "--pull=never",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=65532:65532",
      "--memory=8g",
      "--memory-swap=8g",
      "--cpus=2",
      "--pids-limit=512",
      "--label=io.briar.merge-group-ci.phase=app-check",
      "--label=io.briar.merge-group-ci.deadline-unix=1787270400",
      "--env=HOME=/scratch/home",
      `--env=BRIAR_CI_HEAD_SHA=${headSha}`,
      image,
      "/usr/bin/timeout",
      "60s",
      "app-worker",
      "app-check",
    ]));
    const serialized = args.join("\n");
    expect(serialized).not.toContain("GH_TOKEN");
    expect(serialized).not.toContain("BRIAR_WORKER_TOKEN");
    expect(serialized).not.toContain("DOCKER_CONFIG");
    expect(serialized).not.toContain("dst=/repo");
    expect(serialized).not.toContain("dst=/workspace");
    expect(serialized).toContain("dst=/opt/briar/trusted-bin/bun,readonly");
  });

  it("runs every phase in a fresh container without host credentials", async () => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker(`
env >"${join(prepared.root, "environment-")}$context-$phase.txt"
printf '%s\n' "$@" >"${join(prepared.root, "arguments-")}$context-$phase.txt"
printf 'context=%s phase=%s\n' "$context" "$phase"
exit 0`);
    vi.stubEnv("GH_TOKEN", "github-secret");
    vi.stubEnv("BRIAR_WORKER_TOKEN", "worker-secret");
    vi.stubEnv("NODE_OPTIONS", "--require=/tmp/attack.js");
    vi.stubEnv("DOCKER_CONFIG", "/private/docker");

    const results = await runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: 10_000,
    });
    expect(results.map((result) => result.context)).toEqual(MERGE_GROUP_CI_CONTEXTS);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(new Set(results.map((result) => result.logSha256)).size).toBe(4);

    const names = new Set<string>();
    for (const context of MERGE_GROUP_CI_CONTEXTS) {
      for (const phase of MERGE_GROUP_CI_PHASES[context]) {
        const environment = await readFile(
          join(prepared.root, `environment-${context}-${phase}.txt`),
          "utf8",
        );
        expect(environment).not.toContain("github-secret");
        expect(environment).not.toContain("worker-secret");
        expect(environment).not.toContain("NODE_OPTIONS");
        expect(environment).not.toContain("DOCKER_CONFIG");
        expect(environment).toContain(`HOME=${prepared.root}`);
        const argumentsText = await readFile(
          join(prepared.root, `arguments-${context}-${phase}.txt`),
          "utf8",
        );
        const name = argumentsText.split("\n")
          .find((argument) => argument.startsWith("--name="));
        expect(name).toBeDefined();
        names.add(name!);
      }
    }
    expect(names.size).toBe(
      Object.values(MERGE_GROUP_CI_PHASES).flat().length,
    );
  });

  it("classifies deterministic CI failures without treating them as infrastructure", async () => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker(`
if [[ "$context" == "rust" ]]; then echo 'rust failed'; exit 1; fi
echo ok
exit 0`);
    const results = await runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: 10_000,
    });
    expect(results.find((result) => result.context === "rust")).toMatchObject({
      passed: false,
      exitCode: 1,
      failureCode: "ci_failed",
    });
    expect(results.filter((result) => result.passed)).toHaveLength(3);
  });

  it.each([75, 124])("fails bounded infrastructure exit %i", async (exitCode) => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker(`exit ${exitCode}`);
    await expect(runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: 10_000,
    })).rejects.toBeInstanceOf(MergeGroupCiInfrastructureError);
  });

  it("rejects an overlong deadline", async () => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker("exit 0");
    await expect(runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: MERGE_GROUP_CI_MAX_DEADLINE_MS + 1,
    })).rejects.toBeInstanceOf(ExactShaValidationInputError);
  });

  it("terminates output flooding at a hard bound", async () => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker(`
if [[ "$context" == "app-worker" ]]; then
  head -c ${MERGE_GROUP_CI_MAX_OUTPUT_BYTES + 4096} /dev/zero
else
  echo ok
fi
exit 0`);
    const results = await runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: 10_000,
      killGraceMs: 25,
    });
    expect(results[0]).toMatchObject({
      context: "app-worker",
      passed: false,
      failureCode: "output_limit",
      logTruncated: true,
    });
    expect(Buffer.byteLength(results[0].log)).toBeLessThanOrEqual(256 * 1_024);
  });

  it("kills TERM-ignoring process groups after cancellation", async () => {
    if (process.platform === "win32") return;
    const prepared = await preparedFixture();
    const pidFile = join(prepared.root, "descendants.txt");
    const fake = await fakeDocker(`
trap '' TERM
bash -c 'trap "" TERM; while :; do sleep 1; done' &
echo "$!" >>${JSON.stringify(pidFile)}
while :; do sleep 1; done`);
    const controller = new AbortController();
    const running = runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: controller.signal,
      deadlineMs: 10_000,
      killGraceMs: 25,
    });
    await vi.waitFor(async () => {
      expect(existsSync(pidFile)).toBe(true);
      expect(await readFile(pidFile, "utf8")).toMatch(/\d+/u);
    }, { timeout: 5_000 });
    const pids = (await readFile(pidFile, "utf8"))
      .trim().split("\n").map(Number);
    controller.abort(new Error("lease lost"));
    await expect(running).rejects.toThrow("lease lost");
    await vi.waitFor(() => {
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    }, { timeout: 5_000 });
  });

  it("targets the full POSIX process group", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      expect(terminateProcessGroup({ pid: 4321, kill: vi.fn() } as never,
        "SIGTERM", "darwin")).toBe(true);
      expect(kill).toHaveBeenCalledWith(-4321, "SIGTERM");
    } finally {
      kill.mockRestore();
    }
  });

  it("hashes retained logs deterministically", async () => {
    const prepared = await preparedFixture();
    const fake = await fakeDocker("printf 'stable log'; exit 0");
    const results = await runFixedMergeGroupValidation({
      prepared,
      runtime: { executable: fake.executable, image },
      signal: new AbortController().signal,
      deadlineMs: 10_000,
    });
    const phaseLogHash = createHash("sha256").update("stable log").digest("hex");
    const expected = createHash("sha256");
    for (const phase of MERGE_GROUP_CI_PHASES["app-worker"]) {
      expected.update(phase);
      expected.update("\0");
      expected.update(phaseLogHash);
      expected.update("\0");
      expected.update("0\n");
    }
    expect(results[0].logSha256).toBe(expected.digest("hex"));
  });
});
