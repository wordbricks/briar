/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api/errors";
import { managedComputerRemoteErrorMessage } from "./ManagedComputerRemoteDesktop";

describe("managedComputerRemoteErrorMessage", () => {
  it("maps a bare ApiError code to its translation key", () => {
    expect(managedComputerRemoteErrorMessage(
      new ApiError(
        409,
        "Managed computer remote display agent is offline",
        "MANAGED_COMPUTER_REMOTE_OFFLINE",
      ),
    )).toBe("managedComputer.remote.error.offline");
  });

  /*
    A sandbox that lost its relay credential answered
    `MANAGED_COMPUTER_REMOTE_OFFLINE`, but Connect re-wrapped the `ApiError`
    before the panel saw it, so the owner was shown the raw
    "[unknown] Managed computer remote display agent is offline" instead of the
    localized sentence.
  */
  it("reads through the wrapper Connect puts around an ApiError", () => {
    const wrapped = new Error(
      "[unknown] Managed computer remote display agent is offline",
      {
        cause: new ApiError(
          409,
          "Managed computer remote display agent is offline",
          "MANAGED_COMPUTER_REMOTE_OFFLINE",
        ),
      },
    );
    expect(managedComputerRemoteErrorMessage(wrapped)).toBe(
      "managedComputer.remote.error.offline",
    );
  });

  it("has no key for an unmapped code or a plain failure", () => {
    expect(managedComputerRemoteErrorMessage(
      new ApiError(500, "Boom", "SOMETHING_ELSE"),
    )).toBeNull();
    expect(managedComputerRemoteErrorMessage(new Error("offline"))).toBeNull();
  });
});
