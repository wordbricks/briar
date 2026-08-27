import { describe, expect, it } from "vitest";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateDeepLink,
  workerUpdateLaunch,
} from "./worker-update";

describe("remote Worker updates", () => {
  it("advertises Linux support only for a managed runtime updater", () => {
    expect(supportsRemoteWorkerUpdates("darwin")).toBe(true);
    expect(supportsRemoteWorkerUpdates("linux", {})).toBe(false);
    expect(supportsRemoteWorkerUpdates("linux", {
      BRIAR_MANAGED_RUNTIME_UPDATER:
        "/opt/briar/bin/briar-managed-runtime-update-request",
    })).toBe(true);
  });

  it("builds a constrained Briar app link", () => {
    expect(
      workerUpdateDeepLink({
        id: "77777777-7777-4777-8777-777777777777",
        targetVersion: "1.2.84",
      }),
    ).toBe(
      "briar-companion://worker-update/77777777-7777-4777-8777-777777777777?target=1.2.84",
    );
  });

  it("rejects values that could escape the fixed app-link contract", () => {
    expect(() =>
      workerUpdateDeepLink({ id: "bad", targetVersion: "1.2.84;open" }),
    ).toThrow("Invalid worker update directive");
  });

  it("builds a constrained managed Linux updater invocation", () => {
    expect(workerUpdateLaunch(
      {
        id: "77777777-7777-4777-8777-777777777777",
        targetVersion: "1.2.84",
      },
      "worker-1",
      "linux",
      {
        BRIAR_MANAGED_RUNTIME_UPDATER:
          "/opt/briar/bin/briar-managed-runtime-update-request",
      },
    )).toEqual({
      command: "/opt/briar/bin/briar-managed-runtime-update-request",
      args: [
        "77777777-7777-4777-8777-777777777777",
        "1.2.84",
        "worker-1",
      ],
    });
  });

  it("rejects a relative Linux updater path", () => {
    expect(() => workerUpdateLaunch(
      {
        id: "77777777-7777-4777-8777-777777777777",
        targetVersion: "1.2.84",
      },
      "worker-1",
      "linux",
      { BRIAR_MANAGED_RUNTIME_UPDATER: "runtime-updater" },
    )).toThrow("not supported");
  });
});
