import { getMobilePlatform, isMobileCompanion } from "./platform";

export type AuthorizationPresentation = "launched";

export async function openExternalUrl(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openAuthorization(
  url: string,
): Promise<AuthorizationPresentation> {
  const companionMode = isMobileCompanion();
  const mobilePlatform = getMobilePlatform();

  if (
    companionMode &&
    mobilePlatform === "android" &&
    window.BriarAndroidAuth
  ) {
    window.BriarAndroidAuth.open(url);
    return "launched";
  }

  if ("__TAURI_INTERNALS__" in window) {
    await openExternalUrl(url);
    return "launched";
  }

  await openExternalUrl(url);
  return "launched";
}

export function isAuthorizationCancelled(error: unknown) {
  return error === "user_cancelled" || String(error) === "user_cancelled";
}
