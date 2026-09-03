/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { readActiveOrganizationId } from "../../lib/active-organization";
import { createReactTestRoot } from "../../test/react";
import type { SessionUser } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import { lockedTeamIdAtom } from "../platform";
import { activeOrganizationIdAtom } from "./atoms";
import { useActiveOrganizationPersistence } from "./useActiveOrganizationPersistence";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

function Effects() {
  useActiveOrganizationPersistence();
  return null;
}

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Effects />
    </RegistryContext.Provider>,
  );
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
});

describe("useActiveOrganizationPersistence", () => {
  it("stores the active organization per user", async () => {
    const registry = createTestRegistry([
      [userAtom, user],
      [activeOrganizationIdAtom, "org-a"],
      [lockedTeamIdAtom, null],
    ]);
    const view = await mount(registry);

    expect(readActiveOrganizationId(user.id)).toBe("org-a");

    await act(async () => registry.set(activeOrganizationIdAtom, "org-b"));
    expect(readActiveOrganizationId(user.id)).toBe("org-b");

    await view.cleanup();
  });

  it("writes nothing while signed out or with nothing selected", async () => {
    const registry = createTestRegistry([
      [activeOrganizationIdAtom, "org-a"],
      [lockedTeamIdAtom, null],
    ]);
    const view = await mount(registry);

    expect(readActiveOrganizationId(user.id)).toBeNull();

    // A signed-in account with no organization yet must not clear the value it
    // may have stored earlier either.
    await act(async () => {
      registry.set(userAtom, user);
      registry.set(activeOrganizationIdAtom, null);
    });
    expect(readActiveOrganizationId(user.id)).toBeNull();

    await view.cleanup();
  });

  it("never overwrites the main window's choice from a project window", async () => {
    const registry = createTestRegistry([
      [userAtom, user],
      [activeOrganizationIdAtom, "org-a"],
      [lockedTeamIdAtom, "team-a"],
    ]);
    const view = await mount(registry);

    expect(readActiveOrganizationId(user.id)).toBeNull();

    await view.cleanup();
  });
});
