import { isApiConfigured, type DeviceClientId } from "../lib/api";
import { isMobileCompanion, isWebApp } from "../lib/platform";

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
