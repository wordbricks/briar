/** @vitest-environment jsdom */

import { RegistryContext, useAtomMount } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReactTestRoot } from "../../test/react";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { pendingBriarLinkAtom } from "../navigation/atoms";
import {
  appMenuSettingsListenerAtom,
  briarLinkListenerAtom,
  clickedIssueLinkListenerAtom,
  deepLinkListenerApiAtom,
  statusTrayOpenRunListenerAtom,
  DEEP_LINK_LISTENER_IDLE_TTL_MS,
  type DeepLinkListenerApi,
} from "./atoms";
import type * as Atom from "effect/unstable/reactivity/Atom";

/*
  A native listener costs a real subscription in the host process, so what these
  cases pin is its lifetime: it is registered the first time something observes
  the atom, and unregistered once nothing does — not when a particular component
  happens to unmount, and not before the idle grace period a remount is allowed.
*/

/** Records how many listeners each entry point has open. */
class ListenerServer {
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];

  private register(name: string) {
    this.registered.push(name);
    return () => {
      this.unregistered.push(name);
    };
  }

  open(name: string) {
    return (
      this.registered.filter((entry) => entry === name).length -
      this.unregistered.filter((entry) => entry === name).length
    );
  }

  api(overrides: Partial<DeepLinkListenerApi> = {}): DeepLinkListenerApi {
    return {
      listenForBriarLinks: () => this.register("briarLink"),
      listenForClickedIssueLinks: () => this.register("clickedIssueLink"),
      listenForStatusTrayOpenRun: () => this.register("statusTrayOpenRun"),
      listenForAppMenuSettings: () => this.register("appMenuSettings"),
      macDesktop: true,
      desktop: true,
      ...overrides,
    };
  }
}

function Mounted({ atom }: { readonly atom: Atom.Atom<boolean> }) {
  useAtomMount(atom);
  return null;
}

const mount = async (registry: AtomRegistry, atom: Atom.Atom<boolean>) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Mounted atom={atom} />
    </RegistryContext.Provider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
};

/** Waits out the idle grace period and the registry's sweep bucket. */
const idle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DEEP_LINK_LISTENER_IDLE_TTL_MS + 2_000);
  });
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deep link listener atoms", () => {
  it.each([
    ["briarLink", briarLinkListenerAtom],
    ["clickedIssueLink", clickedIssueLinkListenerAtom],
    ["statusTrayOpenRun", statusTrayOpenRunListenerAtom],
    ["appMenuSettings", appMenuSettingsListenerAtom],
  ] as const)(
    "registers %s on the first mount and releases it after the last unmount",
    async (name, atom) => {
      const server = new ListenerServer();
      const registry = createTestRegistry([
        [deepLinkListenerApiAtom, server.api()],
        [lockedTeamIdAtom, null],
      ]);

      const view = await mount(registry, atom);
      expect(server.open(name)).toBe(1);

      await view.cleanup();
      // Still open: a remount inside the grace period reuses the listener
      // instead of tearing a native subscription down and building it back up.
      expect(server.open(name)).toBe(1);

      await idle();
      expect(server.open(name)).toBe(0);
    },
  );

  it("registers nothing in a project window", async () => {
    const server = new ListenerServer();
    const registry = createTestRegistry([
      [deepLinkListenerApiAtom, server.api()],
      [lockedTeamIdAtom, "team-a"],
    ]);

    const view = await mount(registry, briarLinkListenerAtom);
    const trayView = await mount(registry, statusTrayOpenRunListenerAtom);

    // A pinned window follows neither a `briar://` link nor a tray entry, both
    // of which can name another team.
    expect(server.open("briarLink")).toBe(0);
    expect(server.open("statusTrayOpenRun")).toBe(0);

    await view.cleanup();
    await trayView.cleanup();
  });

  it("writes what a link listener reports into the pending target", async () => {
    const server = new ListenerServer();
    let publish: ((target: never) => void) | null = null;
    const registry = createTestRegistry([
      [
        deepLinkListenerApiAtom,
        server.api({
          listenForBriarLinks: (onLink) => {
            publish = onLink as never;
            return () => {
              publish = null;
            };
          },
        }),
      ],
      [lockedTeamIdAtom, null],
    ]);

    const view = await mount(registry, briarLinkListenerAtom);
    await act(async () => {
      publish?.({ kind: "issue", projectId: "team-a", runId: "run-1" } as never);
    });

    expect(registry.get(pendingBriarLinkAtom)).toEqual({
      kind: "issue",
      projectId: "team-a",
      runId: "run-1",
    });
    await view.cleanup();
  });
});
