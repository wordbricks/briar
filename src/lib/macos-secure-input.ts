import { invoke } from "@tauri-apps/api/core";

/**
 * Conservatively tell native code that Briar's password editor may own Secure
 * Event Input. Native consumes this witness at the next window deactivation.
 */
export function armMacPasswordEditor(): void {
  void invoke("arm_macos_password_editor").catch((error: unknown) => {
    console.warn("Failed to arm the macOS password editor fallback", error);
  });
}
