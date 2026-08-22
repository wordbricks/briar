import { describe, expect, it } from "vitest";
import { parseWorkerUpdateLink } from "./worker-update-links";

describe("Worker update links", () => {
  it("parses a valid remote update request", () => {
    expect(
      parseWorkerUpdateLink(
        "briar-companion://worker-update/77777777-7777-4777-8777-777777777777?target=1.2.84",
      ),
    ).toEqual({
      requestId: "77777777-7777-4777-8777-777777777777",
      targetVersion: "1.2.84",
    });
  });

  it("rejects web links and malformed versions", () => {
    expect(
      parseWorkerUpdateLink(
        "https://example.com/worker-update/77777777-7777-4777-8777-777777777777?target=1.2.84",
      ),
    ).toBeNull();
    expect(
      parseWorkerUpdateLink(
        "briar-companion://worker-update/77777777-7777-4777-8777-777777777777?target=latest",
      ),
    ).toBeNull();
  });
});
