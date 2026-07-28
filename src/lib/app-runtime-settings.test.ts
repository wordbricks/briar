/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadAppRuntimeSettings,
  updateAppRuntimeSettings,
} from "./app-runtime-settings";

describe("app runtime settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults sleep prevention off outside the desktop runtime", async () => {
    await expect(loadAppRuntimeSettings()).resolves.toEqual({
      preventSleepWhileRunning: false,
      preventSleepSupported: false,
    });
  });

  it("keeps the browser fallback preference for the current profile", async () => {
    await updateAppRuntimeSettings({ preventSleepWhileRunning: true });

    await expect(loadAppRuntimeSettings()).resolves.toEqual({
      preventSleepWhileRunning: true,
      preventSleepSupported: false,
    });
  });
});
