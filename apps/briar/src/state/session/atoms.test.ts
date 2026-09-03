import { describe, expect, it } from "vitest";

import type { SessionUser } from "../../types";
import { createTestRegistry } from "../registry";
import {
  loadingAtom,
  loginCodeAtom,
  restoringSessionAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "./atoms";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

describe("session atoms", () => {
  it("starts signed out with the app gated on session restore", () => {
    const registry = createTestRegistry();

    // The test environment configures an API URL, so demo mode is off and the
    // app boots into "restoring a stored session".
    expect(registry.get(userAtom)).toBeNull();
    expect(registry.get(tokenAtom)).toBeNull();
    expect(registry.get(restoringSessionAtom)).toBe(true);
    expect(registry.get(loadingAtom)).toBe(true);
    expect(registry.get(loginCodeAtom)).toBeNull();
    expect(registry.get(sessionErrorAtom)).toBeNull();
  });

  it("notifies a subscriber once per distinct value", () => {
    const registry = createTestRegistry();
    const seen: (SessionUser | null)[] = [];
    const unsubscribe = registry.subscribe(userAtom, (value) => {
      seen.push(value);
    });

    registry.set(userAtom, user);
    // Writing the same reference back is not a change, so it is not announced.
    registry.set(userAtom, user);
    registry.set(userAtom, null);
    unsubscribe();
    registry.set(userAtom, user);

    expect(seen).toEqual([user, null]);
  });

  it("keeps written values after the last subscriber leaves", () => {
    const registry = createTestRegistry();
    const unsubscribe = registry.subscribe(tokenAtom, () => undefined);
    registry.set(tokenAtom, "token-1");
    unsubscribe();

    // `Atom.keepAlive` is what makes this hold: the provider runs without an
    // idle TTL, so an unsubscribed atom would otherwise be discarded and the
    // session silently reset.
    expect(registry.get(tokenAtom)).toBe("token-1");
  });

  it("isolates one registry's session from another's", () => {
    const first = createTestRegistry();
    const second = createTestRegistry();

    first.set(tokenAtom, "token-1");
    first.set(sessionErrorAtom, "실패");

    expect(second.get(tokenAtom)).toBeNull();
    expect(second.get(sessionErrorAtom)).toBeNull();
  });
});
