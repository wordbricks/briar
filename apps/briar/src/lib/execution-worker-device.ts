import { isDesktopTauri } from "./platform";
import { commands } from "../generated/tauri";

/**
 * Returns this desktop app's enrolled Worker device for one organization.
 * Preference is optional, so an unreadable or unregistered local Worker must
 * never prevent the channel message itself from being sent.
 */
export async function currentExecutionWorkerDeviceId(
  organizationId: string,
) {
  if (!isDesktopTauri()) return null;
  try {
    return await commands.currentExecutionWorkerDeviceId(organizationId);
  } catch {
    return null;
  }
}
