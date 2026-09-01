import {
  commands,
  type OnboardingPrerequisite,
} from "../generated/tauri";

export const initialOnboardingStorageKey = "briar.initial-onboarding.seen.v1";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function hasCompletedInitialOnboarding() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(initialOnboardingStorageKey) === "true";
  } catch {
    return false;
  }
}

export function markInitialOnboardingComplete() {
  try {
    window.localStorage.setItem(initialOnboardingStorageKey, "true");
  } catch {
    // The current session can still continue when persistence is unavailable.
  }
}

export async function inspectOnboardingPrerequisites() {
  if (!isTauri()) {
    throw new Error(
      "필수 도구 확인은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
  }
  return commands.inspectOnboardingPrerequisites();
}

export async function installOnboardingPrerequisite(
  prerequisite: OnboardingPrerequisite,
) {
  if (!isTauri()) {
    throw new Error(
      "필수 도구 설치는 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
  }
  return commands.installOnboardingPrerequisite(prerequisite);
}

export async function inspectOpenCodeTerminalPath() {
  if (!isTauri()) {
    throw new Error(
      "OpenCode 터미널 PATH 확인은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
  }
  return commands.inspectOpenCodeTerminalPath();
}

export async function configureOpenCodeTerminalPath() {
  if (!isTauri()) {
    throw new Error(
      "OpenCode 터미널 PATH 설정은 Briar 데스크톱 앱에서 사용할 수 있습니다.",
    );
  }
  return commands.configureOpenCodeTerminalPath();
}
