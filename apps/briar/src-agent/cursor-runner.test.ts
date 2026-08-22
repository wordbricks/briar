import { describe, expect, it } from "vitest";
import { shouldSuppressCursorNotification } from "./cursor-runner";

describe("Cursor runner transport", () => {
  it("suppresses replay and load-time notifications", () => {
    expect(shouldSuppressCursorNotification({
      method: "session/update",
      params: { _meta: { isReplay: true } },
    }, false)).toBe(true);
    expect(shouldSuppressCursorNotification({ method: "session/update" }, true)).toBe(true);
    expect(shouldSuppressCursorNotification({ method: "session/update" }, false)).toBe(false);
  });
});
