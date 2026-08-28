import { commands } from "../generated/tauri";

/**
 * Conservatively tell native code that Briar's password editor may own Secure
 * Event Input. Native consumes this witness at the next window deactivation.
 */
export function armMacPasswordEditor(): void {
  void commands.armMacosPasswordEditor().catch((error: unknown) => {
    console.warn("Failed to arm the macOS password editor fallback", error);
  });
}
