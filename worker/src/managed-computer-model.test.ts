import { describe, expect, it } from "vitest";
import { managedComputerConfig } from "./managed-computer-model";

describe("managed computer remote desktop configuration", () => {
  it("deduplicates approved origins and rejects unsafe duration limits", () => {
    const config = managedComputerConfig({
      MANAGED_COMPUTER_API_ORIGIN: "https://briar.example/path",
      MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED: "true",
      MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS:
        "https://briar.example,https://staging.example,https://staging.example",
      MANAGED_COMPUTER_REMOTE_DESKTOP_TOKEN_TTL_SECONDS: "301",
      MANAGED_COMPUTER_REMOTE_DESKTOP_MAX_SESSION_MINUTES: "481",
    } as Env);
    expect(config.remoteDesktopEnabled).toBe(true);
    expect(config.remoteDesktopAllowedOrigins.filter(
      (origin) => origin === "https://briar.example",
    )).toHaveLength(1);
    expect(config.remoteDesktopAllowedOrigins).toContain(
      "https://staging.example",
    );
    expect(config.remoteDesktopTokenTtlSeconds).toBe(60);
    expect(config.remoteDesktopMaxSessionMinutes).toBe(60);
  });
});
