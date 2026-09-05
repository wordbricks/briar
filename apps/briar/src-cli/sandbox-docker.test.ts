import { describe, expect, it } from "vitest";
import {
  type DockerCommandResult,
  type DockerRunner,
  ensureDockerContext,
  ensureSandbox,
  getSandboxStatus,
  inspectSandboxContainer,
  removeSandbox,
  SANDBOX_GPU_LABEL,
  SANDBOX_NAME_LABEL,
  SANDBOX_OWNER_LABEL,
  SANDBOX_RUNTIME_LABEL,
  SANDBOX_SCHEMA_LABEL,
  SANDBOX_VIEW_PORT_LABEL,
  sandboxContainerName,
  sandboxHomeVolume,
  sandboxName,
  sandboxRunArguments,
  stopSandbox,
} from "./sandbox-docker";
import { SANDBOX_SCHEMA_VERSION, sandboxImageTag } from "./sandbox-image";

const runtimeSha256 = "a".repeat(64);
const name = "gx10";
const container = sandboxContainerName(name);

type Container = {
  running: boolean;
  image: string;
  labels: Record<string, string>;
};

const readyReport = {
  schemaVersion: SANDBOX_SCHEMA_VERSION,
  ready: true,
  supervisorRunning: true,
  computerUse: { serviceHealthy: true, displays: [{ agentId: "agent-a", displayIndex: 2 }] },
  detail: "Sandbox is ready.",
  teams: [],
  providers: {},
};

const unregisterReport = {
  teams: [{ id: "11111111-1111-4111-8111-111111111111", workerId: "worker-1", state: "unbound" }],
};

/**
 * Minimal in-memory Docker daemon: enough of `info`, `inspect`, `image`,
 * `build`, `run`, `start`, `stop`, `rm`, `logs`, `exec`, and `context` to
 * exercise the connector without a real daemon.
 */
function fakeDocker(initial: {
  daemon?: boolean;
  containers?: Record<string, Container>;
  images?: string[];
  report?: () => unknown;
  unregister?: () => unknown;
  contexts?: Record<string, string>;
} = {}) {
  const calls: string[][] = [];
  const state = {
    daemon: initial.daemon ?? true,
    containers: initial.containers ?? {},
    images: new Set(initial.images ?? []),
    report: initial.report ?? (() => readyReport),
    unregister: initial.unregister ?? (() => unregisterReport),
    contexts: initial.contexts ?? {},
  };
  const ok = (output = ""): DockerCommandResult => ({ ok: true, output });
  const fail = (output: string): DockerCommandResult => ({ ok: false, output });
  const docker: DockerRunner = async (args, options) => {
    calls.push([...args, ...(options?.stdin === undefined ? [] : ["<stdin>"])]);
    const [command, ...rest] = args;
    if (command === "info") return state.daemon ? ok("28.0.0") : fail("Cannot connect");
    if (command === "inspect") {
      const target = state.containers[rest.at(-1)!];
      return target
        ? ok(JSON.stringify({
          State: { Running: target.running },
          Config: { Image: target.image, Labels: target.labels },
        }))
        : fail("No such object");
    }
    if (command === "image") {
      if (rest[0] === "rm") {
        const existed = state.images.delete(rest.at(-1)!);
        return existed ? ok("Untagged") : fail("No such image");
      }
      return state.images.has(rest.at(-1)!) ? ok("sha256:abc") : fail("No such image");
    }
    if (command === "build") {
      state.images.add(rest[rest.indexOf("--tag") + 1]!);
      return ok("built");
    }
    if (command === "run") {
      const labels: Record<string, string> = {};
      rest.forEach((argument, index) => {
        if (argument === "--label") {
          const [key, value] = rest[index + 1]!.split("=", 2);
          labels[key!] = value!;
        }
      });
      state.containers[rest[rest.indexOf("--name") + 1]!] = {
        running: true,
        image: rest.at(-1)!,
        labels,
      };
      return ok("container-id");
    }
    if (command === "start" || command === "restart") {
      const target = state.containers[rest.at(-1)!];
      if (!target) return fail("No such container");
      target.running = true;
      return ok();
    }
    if (command === "stop") {
      const target = state.containers[rest.at(-1)!];
      if (!target) return fail("No such container");
      target.running = false;
      return ok();
    }
    if (command === "rm") {
      const existed = rest.at(-1)! in state.containers;
      delete state.containers[rest.at(-1)!];
      return existed ? ok() : fail("Error: No such container");
    }
    if (command === "volume") return ok();
    if (command === "logs") return ok("boot log");
    if (command === "exec") {
      const target = state.containers[rest.find((argument) => argument.startsWith("briar-sandbox-"))!];
      if (!target?.running) return fail("container not running");
      if (rest.includes("report")) return ok(JSON.stringify(state.report()));
      if (rest.includes("unregister")) return ok(JSON.stringify(state.unregister()));
      return ok("bootstrapped");
    }
    if (command === "context") {
      const [operation, contextName] = rest;
      if (operation === "inspect") {
        const host = state.contexts[rest.at(-1)!];
        return host ? ok(host) : fail("context not found");
      }
      if (operation === "create" || operation === "update") {
        state.contexts[contextName!] = rest.at(-1)!.replace(/^host=/u, "");
        return ok();
      }
      if (operation === "rm") {
        const existed = rest.at(-1)! in state.contexts;
        delete state.contexts[rest.at(-1)!];
        return existed ? ok() : fail("context not found");
      }
    }
    return fail(`unsupported: ${args.join(" ")}`);
  };
  return { docker, calls, state };
}

const ownedLabels = (sha = runtimeSha256, gpus = "0", viewPort = "6080") => ({
  [SANDBOX_OWNER_LABEL]: "1",
  [SANDBOX_NAME_LABEL]: name,
  [SANDBOX_RUNTIME_LABEL]: sha,
  [SANDBOX_SCHEMA_LABEL]: SANDBOX_SCHEMA_VERSION,
  [SANDBOX_GPU_LABEL]: gpus,
  [SANDBOX_VIEW_PORT_LABEL]: viewPort,
});

const ensureInput = (fake: ReturnType<typeof fakeDocker>, gpus = false) => {
  const bootstraps: number[] = [];
  return {
    input: {
      name,
      runtimeSha256,
      buildContextDirectory: "/tmp/context",
      gpus,
      bootstrap: async () => {
        bootstraps.push(Date.now());
      },
      sleep: async () => undefined,
      readyTimeoutMs: 5_000,
    },
    bootstraps,
    fake,
  };
};

describe("sandbox names", () => {
  it("defaults and validates", () => {
    expect(sandboxName(undefined)).toBe("default");
    expect(sandboxName("gx10")).toBe("gx10");
    expect(() => sandboxName("GX10")).toThrow("Sandbox name");
    expect(() => sandboxName("a b")).toThrow("Sandbox name");
  });
});

describe("sandbox run arguments", () => {
  it("labels the container, mounts only the home volume, and publishes only the loopback view", () => {
    const args = sandboxRunArguments({
      name,
      runtimeSha256,
      imageTag: sandboxImageTag(runtimeSha256),
      gpus: false,
    });
    expect(args).toContain(`${SANDBOX_OWNER_LABEL}=1`);
    expect(args).toContain(`${SANDBOX_RUNTIME_LABEL}=${runtimeSha256}`);
    expect(args).toContain(`${SANDBOX_SCHEMA_LABEL}=${SANDBOX_SCHEMA_VERSION}`);
    expect(args).toContain(`${sandboxHomeVolume(name)}:/home/briar`);
    expect(args.filter((argument) => argument === "--publish")).toHaveLength(1);
    expect(args).toContain("127.0.0.1:6080:6080");
    expect(args).not.toContain("--gpus");
    expect(args.at(-1)).toBe(sandboxImageTag(runtimeSha256));
  });

  it("publishes noVNC on the host loopback only", () => {
    const args = sandboxRunArguments({
      name,
      runtimeSha256,
      imageTag: "briar-sandbox:test",
      gpus: false,
      viewPort: 6090,
    });
    expect(args.slice(args.indexOf("--publish"), args.indexOf("--publish") + 2))
      .toEqual(["--publish", "127.0.0.1:6090:6080"]);
    expect(args.filter((argument) => argument === "--publish")).toHaveLength(1);
    expect(args).toContain(`${SANDBOX_VIEW_PORT_LABEL}=6090`);
  });

  it("requests every GPU only when asked", () => {
    const args = sandboxRunArguments({
      name,
      runtimeSha256,
      imageTag: "briar-sandbox:test",
      gpus: true,
    });
    expect(args.slice(args.indexOf("--gpus"), args.indexOf("--gpus") + 2))
      .toEqual(["--gpus", "all"]);
  });
});

describe("getSandboxStatus", () => {
  it("reports an unavailable daemon", async () => {
    const { docker } = fakeDocker({ daemon: false });
    const status = await getSandboxStatus(docker, name);
    expect(status).toMatchObject({ available: false, running: false, ready: false });
  });

  it("offers to create a missing sandbox", async () => {
    const { docker } = fakeDocker();
    expect(await getSandboxStatus(docker, name)).toMatchObject({
      available: true,
      running: false,
      detail: "Ready to create the sandbox.",
    });
  });

  it("refuses to claim a container Briar does not own", async () => {
    const { docker } = fakeDocker({
      containers: { [container]: { running: true, image: "other", labels: {} } },
    });
    const status = await getSandboxStatus(docker, name);
    expect(status.ready).toBe(false);
    expect(status.detail).toContain("not owned by Briar");
    expect(await inspectSandboxContainer(docker, name)).toMatchObject({ owned: false });
  });

  it("is ready when the in-container report says so", async () => {
    const { docker } = fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    const status = await getSandboxStatus(docker, name);
    expect(status).toMatchObject({ ready: true, runtimeSha256, detail: "Sandbox is ready." });
    expect(status.report?.ready).toBe(true);
  });
});

describe("ensureSandbox", () => {
  it("builds the image, creates the container, bootstraps, and waits for readiness", async () => {
    const { input, bootstraps, fake } = ensureInput(fakeDocker());
    const status = await ensureSandbox(fake.docker, input);
    expect(status.ready).toBe(true);
    expect(bootstraps).toHaveLength(1);
    const commands = fake.calls.map((call) => call[0]);
    expect(commands.indexOf("build")).toBeLessThan(commands.indexOf("run"));
    expect(fake.state.images.has(sandboxImageTag(runtimeSha256))).toBe(true);
    expect(fake.state.containers[container]?.labels[SANDBOX_RUNTIME_LABEL]).toBe(runtimeSha256);
  });

  it("passes a non-default Debian mirror to the image build", async () => {
    const { input, fake } = ensureInput(fakeDocker());
    await ensureSandbox(fake.docker, { ...input, debianMirror: "ftp.kr.debian.org" });
    const build = fake.calls.find((call) => call[0] === "build")!;
    expect(build).toContain("--build-arg");
    expect(build).toContain("DEBIAN_MIRROR=ftp.kr.debian.org");
    const plain = fakeDocker();
    await ensureSandbox(plain.docker, { ...input, debianMirror: "deb.debian.org" });
    expect(plain.calls.find((call) => call[0] === "build")!).not.toContain("--build-arg");
  });

  it("skips the build when the image already exists and restarts a stopped container", async () => {
    const { input, fake } = ensureInput(fakeDocker({
      images: [sandboxImageTag(runtimeSha256)],
      containers: {
        [container]: { running: false, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    }));
    await ensureSandbox(fake.docker, input);
    const commands = fake.calls.map((call) => call[0]);
    expect(commands).not.toContain("build");
    expect(commands).not.toContain("run");
    expect(commands).toContain("start");
  });

  it("replaces a container whose runtime digest is stale", async () => {
    const { input, fake } = ensureInput(fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:old", labels: ownedLabels("b".repeat(64)) },
      },
    }));
    await ensureSandbox(fake.docker, input);
    const commands = fake.calls.map((call) => call[0]);
    expect(commands.indexOf("rm")).toBeLessThan(commands.indexOf("run"));
    expect(fake.state.containers[container]?.labels[SANDBOX_RUNTIME_LABEL]).toBe(runtimeSha256);
  });

  it("replaces a container when the GPU request changes", async () => {
    const { input, fake } = ensureInput(fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels(runtimeSha256, "0") },
      },
    }), true);
    await ensureSandbox(fake.docker, input);
    expect(fake.calls.map((call) => call[0])).toContain("rm");
    expect(fake.state.containers[container]?.labels[SANDBOX_GPU_LABEL]).toBe("1");
  });

  it("replaces a container when the view port changes", async () => {
    const { input, fake } = ensureInput(fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels(runtimeSha256, "0", "6080") },
      },
    }));
    await ensureSandbox(fake.docker, { ...input, viewPort: 6091 });
    expect(fake.calls.map((call) => call[0])).toContain("rm");
    expect(fake.state.containers[container]?.labels[SANDBOX_VIEW_PORT_LABEL]).toBe("6091");
  });

  it("refuses an unowned container with the same name", async () => {
    const { input, fake } = ensureInput(fakeDocker({
      containers: { [container]: { running: true, image: "other", labels: {} } },
    }));
    await expect(ensureSandbox(fake.docker, input)).rejects.toThrow("unowned container");
    expect(fake.calls.map((call) => call[0])).not.toContain("rm");
  });

  it("surfaces container logs when the sandbox dies before it is ready", async () => {
    const fake = fakeDocker({ report: () => ({ ...readyReport, ready: false }) });
    const { input } = ensureInput(fake);
    const originalDocker = fake.docker;
    let polls = 0;
    const docker: DockerRunner = async (args, options) => {
      if (args[0] === "exec" && args.includes("report") && ++polls === 2) {
        fake.state.containers[container]!.running = false;
      }
      return originalDocker(args, options);
    };
    await expect(ensureSandbox(docker, input)).rejects.toThrow("boot log");
  });

  it("times out with the last report detail", async () => {
    const fake = fakeDocker({
      report: () => ({ ...readyReport, ready: false, detail: "Waiting for bootstrap." }),
    });
    const { input } = ensureInput(fake);
    await expect(ensureSandbox(fake.docker, { ...input, readyTimeoutMs: 1 }))
      .rejects.toThrow("Waiting for bootstrap.");
  });
});

describe("stop and remove", () => {
  it("stops only owned running containers", async () => {
    const fake = fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    expect(await stopSandbox(fake.docker, name)).toBe(true);
    expect(fake.state.containers[container]?.running).toBe(false);
    expect(await stopSandbox(fake.docker, name)).toBe(false);
  });

  it("refuses to stop or remove unowned containers", async () => {
    const fake = fakeDocker({
      containers: { [container]: { running: true, image: "other", labels: {} } },
    });
    await expect(stopSandbox(fake.docker, name)).rejects.toThrow("unowned");
    await expect(removeSandbox(fake.docker, name, { purge: true, unregisterWorkers: true }))
      .rejects.toThrow("unowned");
    expect(fake.state.containers[container]).toBeDefined();
    expect(fake.calls.map((call) => call[0])).not.toContain("exec");
  });

  it("unregisters workers before deleting the container", async () => {
    const fake = fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    const result = await removeSandbox(fake.docker, name, { purge: false, unregisterWorkers: true });
    expect(result.existed).toBe(true);
    expect(result.unregistered?.teams[0]).toMatchObject({ workerId: "worker-1", state: "unbound" });
    const commands = fake.calls.map((call) => call[0]);
    expect(commands.indexOf("exec")).toBeLessThan(commands.indexOf("rm"));
    expect(fake.state.containers[container]).toBeUndefined();
    expect(result.volumeRemoved).toBe(false);
    expect(fake.calls.some((call) => call[0] === "volume")).toBe(false);
  });

  it("starts a stopped container so its workers can still be unregistered", async () => {
    const fake = fakeDocker({
      containers: {
        [container]: { running: false, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    const result = await removeSandbox(fake.docker, name, { purge: false, unregisterWorkers: true });
    const commands = fake.calls.map((call) => call[0]);
    expect(commands.indexOf("start")).toBeLessThan(commands.indexOf("exec"));
    expect(result.unregistered?.teams).toHaveLength(1);
  });

  it("reports rather than throws when unregistration fails, and still removes the container", async () => {
    const fake = fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    const failing: DockerRunner = async (args, options) =>
      args[0] === "exec" && args.includes("unregister")
        ? { ok: false, output: "network down" }
        : fake.docker(args, options);
    const result = await removeSandbox(failing, name, { purge: false, unregisterWorkers: true });
    expect(result.unregistered).toBeNull();
    expect(result.unregisterDetail).toContain("network down");
    expect(fake.state.containers[container]).toBeUndefined();
  });

  it("skips unregistration when asked to keep workers", async () => {
    const fake = fakeDocker({
      containers: {
        [container]: { running: true, image: "briar-sandbox:x", labels: ownedLabels() },
      },
    });
    const result = await removeSandbox(fake.docker, name, { purge: false, unregisterWorkers: false });
    expect(result.unregistered).toBeNull();
    expect(fake.calls.map((call) => call[0])).not.toContain("exec");
  });

  it("purges the volume, image, and Briar-created context", async () => {
    const imageTag = sandboxImageTag(runtimeSha256);
    const fake = fakeDocker({
      images: [imageTag],
      contexts: { "briar-sandbox-gx10": "ssh://jay@gx10" },
      containers: {
        [container]: { running: true, image: imageTag, labels: ownedLabels() },
      },
    });
    const result = await removeSandbox(fake.docker, name, {
      purge: true,
      unregisterWorkers: true,
      imageTag,
      dockerContext: "briar-sandbox-gx10",
      contextRunner: fake.docker,
    });
    expect(result).toMatchObject({
      existed: true,
      volumeRemoved: true,
      imageRemoved: true,
      contextRemoved: true,
    });
    expect(fake.state.images.has(imageTag)).toBe(false);
    expect(fake.state.contexts["briar-sandbox-gx10"]).toBeUndefined();
    const again = await removeSandbox(fake.docker, name, { purge: false, unregisterWorkers: true });
    expect(again.existed).toBe(false);
    expect(again.unregistered).toBeNull();
  });

  it("refuses to delete a Docker context Briar did not create", async () => {
    const fake = fakeDocker({ contexts: { "desktop-linux": "unix:///x" } });
    await expect(removeSandbox(fake.docker, name, {
      purge: true,
      unregisterWorkers: false,
      dockerContext: "desktop-linux",
      contextRunner: fake.docker,
    })).rejects.toThrow("did not create");
    expect(fake.state.contexts["desktop-linux"]).toBe("unix:///x");
  });
});

describe("ensureDockerContext", () => {
  it("creates, reuses, and updates the context for a host", async () => {
    const fake = fakeDocker();
    const created = await ensureDockerContext(fake.docker, { name, host: "ssh://jay@gx10" });
    expect(created).toBe("briar-sandbox-gx10");
    expect(fake.state.contexts[created]).toBe("ssh://jay@gx10");
    await ensureDockerContext(fake.docker, { name, host: "ssh://jay@gx10" });
    expect(fake.calls.filter((call) => call[1] === "create")).toHaveLength(1);
    await ensureDockerContext(fake.docker, { name, host: "ssh://jay@gx10.local" });
    expect(fake.state.contexts[created]).toBe("ssh://jay@gx10.local");
  });

  it("rejects hosts that are not Docker endpoints", async () => {
    const fake = fakeDocker();
    await expect(ensureDockerContext(fake.docker, { name, host: "gx10" }))
      .rejects.toThrow("ssh://");
  });
});
