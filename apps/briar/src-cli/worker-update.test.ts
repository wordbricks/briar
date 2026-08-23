import { describe, expect, it } from "vitest";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateDeepLink,
} from "./worker-update";

describe("remote Worker updates", () => {
  it("only advertises support on macOS", () => {
    expect(supportsRemoteWorkerUpdates("darwin")).toBe(true);
    expect(supportsRemoteWorkerUpdates("linux")).toBe(false);
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
});
