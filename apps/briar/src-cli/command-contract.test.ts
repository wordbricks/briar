import { describe, expect, it } from "vitest";
import { httpErrorMessage } from "./command-contract";

describe("CLI command contracts", () => {
  it("reads supported HTTP error envelopes without trusting arbitrary bodies", () => {
    expect(httpErrorMessage({ message: "Conflict", requestId: "request-1" }))
      .toBe("Conflict");
    expect(httpErrorMessage({ message: 409 })).toBeUndefined();
    expect(httpErrorMessage(null)).toBeUndefined();
  });
});
