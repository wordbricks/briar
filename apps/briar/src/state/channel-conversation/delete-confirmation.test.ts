import { describe, expect, it } from "vitest";

import { createTestRegistry } from "../registry";
import {
  channelMessageDeleteConfirmationAtom,
  confirmChannelMessageDeletion,
} from "./delete-confirmation";

describe("confirmChannelMessageDeletion", () => {
  it("publishes the prompt and resolves true when the dialog confirms", async () => {
    const registry = createTestRegistry();
    const pending = confirmChannelMessageDeletion(registry, "Delete?");
    const confirmation = registry.get(channelMessageDeleteConfirmationAtom);
    expect(confirmation?.prompt).toBe("Delete?");
    confirmation?.resolve(true);
    await expect(pending).resolves.toBe(true);
    expect(registry.get(channelMessageDeleteConfirmationAtom)).toBeNull();
  });

  it("resolves false when the dialog dismisses", async () => {
    const registry = createTestRegistry();
    const pending = confirmChannelMessageDeletion(registry, "Delete?");
    registry.get(channelMessageDeleteConfirmationAtom)?.resolve(false);
    await expect(pending).resolves.toBe(false);
    expect(registry.get(channelMessageDeleteConfirmationAtom)).toBeNull();
  });

  it("dismisses a stale question as unanswered when a new one arrives", async () => {
    const registry = createTestRegistry();
    const first = confirmChannelMessageDeletion(registry, "First?");
    const second = confirmChannelMessageDeletion(registry, "Second?");
    await expect(first).resolves.toBe(false);
    const current = registry.get(channelMessageDeleteConfirmationAtom);
    expect(current?.prompt).toBe("Second?");
    current?.resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it("answers a question only once", async () => {
    const registry = createTestRegistry();
    const pending = confirmChannelMessageDeletion(registry, "Delete?");
    const confirmation = registry.get(channelMessageDeleteConfirmationAtom);
    confirmation?.resolve(false);
    confirmation?.resolve(true);
    await expect(pending).resolves.toBe(false);
  });
});
