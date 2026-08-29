/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { ManagedComputerSetupWizard } from "./ManagedComputerSetupWizard";

const computer = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  requesterUserId: "user-one",
  state: "needs_setup" as const,
  region: "us-east-1",
  instanceId: "i-example",
  volumeId: "vol-example",
  deviceId: "managed-11111111-1111-4111-8111-111111111111",
  error: null,
  retryCount: 0,
  retryAvailable: false,
  createdAt: "2026-08-29T00:00:00.000Z",
  expiresAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("ManagedComputerSetupWizard", () => {
  it("offers Codex, Claude, Grok, and OpenCode from the first setup screen", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <ManagedComputerSetupWizard
        computer={computer}
        onComplete={vi.fn()}
        onOpenChange={vi.fn()}
        open
        organizationId={computer.organizationId}
        projects={[{
          id: "33333333-3333-4333-8333-333333333333",
          name: "Briar",
          organizationId: computer.organizationId,
          createdAt: "2026-08-29T00:00:00.000Z",
        }]}
        token="user-token"
      />,
    );

    const providerRadios = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    expect(providerRadios.map((radio) => radio.textContent)).toEqual([
      expect.stringContaining("Codex"),
      expect.stringContaining("Claude"),
      expect.stringContaining("Grok"),
      expect.stringContaining("OpenCode"),
    ]);
    expect(providerRadios[0]?.getAttribute("aria-checked")).toBe("true");
    await act(async () => providerRadios[3]?.click());
    expect(providerRadios[3]?.getAttribute("aria-checked")).toBe("true");

    await cleanup();
  });
});
