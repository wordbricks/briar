import { describe, expect, it } from "vitest";
import {
  managedComputerRemoteAgentSocketUrl,
  managedComputerRemoteDisplayEndpoint,
  parseManagedComputerRemoteAgentConfig,
} from "./managed-computer-remote-session-agent";

const managedComputerId = "11111111-1111-4111-8111-111111111111";

describe("managed computer remote session agent", () => {
  it("binds a managed worker credential to the same computer and secure origin", () => {
    const config = parseManagedComputerRemoteAgentConfig({
      credential: "briar_worker_example",
      deviceId: `managed-${managedComputerId}`,
      organizationId: "22222222-2222-4222-8222-222222222222",
      managedComputerId,
      apiOrigin: "https://briar.example",
    });
    expect(managedComputerRemoteAgentSocketUrl(config)).toBe(
      `wss://briar.example/managed-computers/${managedComputerId}/remote-agent`,
    );
  });

  it("refuses a non-loopback display target", () => {
    expect(() => managedComputerRemoteDisplayEndpoint({
      BRIAR_REMOTE_DISPLAY_HOST: "0.0.0.0",
      BRIAR_REMOTE_DISPLAY_PORT: "5901",
    })).toThrow("loopback");
  });
});
