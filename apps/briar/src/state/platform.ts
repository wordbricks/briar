import * as Atom from "effect/unstable/reactivity/Atom";

import { isApiConfigured, type DeviceClientId } from "../lib/api";
import { isMobileCompanion, isWebApp } from "../lib/platform";
import { readTeamWindowProjectId } from "../lib/team-window";

/**
 * Which shape of the app is running, decided once at module load. The values
 * come from the build-time environment and from the user agent, so nothing in
 * a session can change them; state modules read them as constants.
 */
export const demoMode =
  import.meta.env.VITE_BRIAR_DEMO !== "false" && !isApiConfigured;
export const companionMode = isMobileCompanion();
export const webMode = isWebApp();
export const remoteMode = companionMode || webMode;
export const deviceClientId: DeviceClientId = companionMode
  ? "briar-mobile"
  : "briar-desktop";

/**
 * The team a project window is pinned to, or `null` in the main window. Read
 * once at module load, like every other fact in this file.
 */
export const lockedTeamId: string | null = readTeamWindowProjectId();

/**
 * {@link lockedTeamId} as an atom, so tests can reach the pinned-window
 * branches without mocking the module: they seed it on their own registry.
 */
export const lockedTeamIdAtom = Atom.make<string | null>(lockedTeamId).pipe(
  Atom.keepAlive,
  Atom.withLabel("platform/lockedTeamId"),
);
