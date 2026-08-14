import { isDesktopTauri } from "./platform";

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
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("current_execution_worker_device_id", {
      organizationId,
    });
  } catch {
    return null;
  }
}
