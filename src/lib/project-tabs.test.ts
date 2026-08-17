import { describe, expect, it } from "vitest";
import { isProjectScheduleTabEnabled } from "./project-tabs";

describe("isProjectScheduleTabEnabled", () => {
  it("defaults to visible when the project has no saved preference", () => {
    expect(isProjectScheduleTabEnabled(undefined)).toBe(true);
    expect(isProjectScheduleTabEnabled({ scheduleTabEnabled: undefined })).toBe(
      true,
    );
  });

  it("hides the schedule tab only when it is explicitly turned off", () => {
    expect(isProjectScheduleTabEnabled({ scheduleTabEnabled: true })).toBe(true);
    expect(isProjectScheduleTabEnabled({ scheduleTabEnabled: false })).toBe(
      false,
    );
  });
});
