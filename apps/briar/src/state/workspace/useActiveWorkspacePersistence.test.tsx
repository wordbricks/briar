/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { readActiveWorkspaceId } from "../../lib/active-workspace";
import { createReactTestRoot } from "../../test/react";
import type { SessionUser } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import { lockedTeamIdAtom } from "../platform";
import { activeWorkspaceIdAtom } from "./atoms";
import { useActiveWorkspacePersistence } from "./useActiveWorkspacePersistence";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

function Effects() {
  useActiveWorkspacePersistence();
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

describe("useActiveWorkspacePersistence", () => {
  it("stores the active workspace per user", async () => {
    const registry = createTestRegistry([
      [userAtom, user],
      [activeWorkspaceIdAtom, "org-a"],
      [lockedTeamIdAtom, null],
    ]);
    const view = await mount(registry);

    expect(readActiveWorkspaceId(user.id)).toBe("org-a");

    await act(async () => registry.set(activeWorkspaceIdAtom, "org-b"));
    expect(readActiveWorkspaceId(user.id)).toBe("org-b");

    await view.cleanup();
  });

  it("writes nothing while signed out or with nothing selected", async () => {
    const registry = createTestRegistry([
      [activeWorkspaceIdAtom, "org-a"],
      [lockedTeamIdAtom, null],
    ]);
    const view = await mount(registry);

    expect(readActiveWorkspaceId(user.id)).toBeNull();

    // A signed-in account with no workspace yet must not clear the value it
    // may have stored earlier either.
    await act(async () => {
      registry.set(userAtom, user);
      registry.set(activeWorkspaceIdAtom, null);
    });
    expect(readActiveWorkspaceId(user.id)).toBeNull();

    await view.cleanup();
  });

  it("never overwrites the main window's choice from a project window", async () => {
    const registry = createTestRegistry([
      [userAtom, user],
      [activeWorkspaceIdAtom, "org-a"],
      [lockedTeamIdAtom, "team-a"],
    ]);
    const view = await mount(registry);

    expect(readActiveWorkspaceId(user.id)).toBeNull();

    await view.cleanup();
  });
});
