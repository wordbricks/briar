import { describe, expect, it } from "vitest";
import { computerUseChildEnvironment } from "./computer-use-mcp-server";

describe("Computer Use child environment", () => {
  it("binds GUI and browser processes to the assigned desktop", () => {
    expect(computerUseChildEnvironment(7, {
      HOME: "/home/briar",
      DISPLAY: ":1",
    })).toEqual({
      HOME: "/home/briar",
      DISPLAY: ":7",
      BRIAR_BROWSER_PROFILE_DIRECTORY:
        "/var/lib/briar-computer-use/profiles/display-7",
    });
  });

  it("rejects the primary desktop", () => {
    expect(() => computerUseChildEnvironment(1, {})).toThrow(
      "Computer Use display index must be between 2 and 100",
    );
  });
});
