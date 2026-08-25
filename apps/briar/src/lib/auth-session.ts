import { getMobilePlatform, isMobileCompanion } from "./platform";

export type AuthorizationPresentation = "completed" | "launched";
export type AuthorizationStrategy =
  | "ios_auth_session"
  | "android_bridge"
  | "external";

const callbackUrlScheme = "briar-companion";

export function authorizationStrategy(input: {
  companionMode: boolean;
  mobilePlatform: ReturnType<typeof getMobilePlatform>;
  tauri: boolean;
  androidBridge: boolean;
}): AuthorizationStrategy {
  if (input.companionMode && input.mobilePlatform === "ios" && input.tauri) {
    return "ios_auth_session";
  }
  if (
    input.companionMode &&
    input.mobilePlatform === "android" &&
    input.androidBridge
  ) {
    return "android_bridge";
  }
  return "external";
}

export const iosAuthorizationInvocation = (url: string) => ({
  command: "plugin:auth-session|start",
  payload: {
    authUrl: url,
    callbackUrlScheme,
    ephemeral: false,
  },
});

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
  const strategy = authorizationStrategy({
    companionMode,
    mobilePlatform,
    tauri: "__TAURI_INTERNALS__" in window,
    androidBridge: Boolean(window.BriarAndroidAuth),
  });

  if (strategy === "ios_auth_session") {
    const { invoke } = await import("@tauri-apps/api/core");
    const invocation = iosAuthorizationInvocation(url);
    await invoke<string>(invocation.command, invocation.payload);
    return "completed";
  }

  if (strategy === "android_bridge" && window.BriarAndroidAuth) {
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
