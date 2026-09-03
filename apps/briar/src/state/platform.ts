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
 * The team a project window is pinned to, or `null` in the main window.
 *
 * It is a window scoped constant read from the URL, so it belongs with the
 * other platform facts. It is an atom rather than a plain constant because
 * tests need to reach the pinned-window branches without mocking the module,
 * and because `useBriar` seeds it per registry from its own option.
 */
export const lockedTeamIdAtom = Atom.make<string | null>(
  readTeamWindowProjectId(),
).pipe(Atom.keepAlive, Atom.withLabel("platform/lockedTeamId"));
