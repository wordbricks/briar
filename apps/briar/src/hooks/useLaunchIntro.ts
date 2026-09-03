import { useCallback, useEffect, useRef, useState } from "react";

import { commands } from "../generated/tauri";
import {
  clearLaunchIntroPreview,
  isLaunchIntroPreview,
  markLaunchIntroSeen,
  shouldShowLaunchIntro,
} from "../lib/launch-intro";
import {
  isDesktopTauri,
  isMacDesktopTauri,
  isWebApp,
} from "../lib/platform";

/*
  The desktop window's first seconds: the launch intro, the compact onboarding
  size, and telling Rust the window is worth showing.

  The three effects are declared in that order on purpose — the reveal must not
  land before the onboarding resize has settled the window's final size — so
  they stay together in one hook rather than moving to their own surfaces.
*/

/** The window commands this hook drives, so tests can observe them. */
export interface LaunchIntroDeps {
  readonly prepareLaunchIntro?: () => Promise<unknown>;
  readonly showMainWindow?: () => Promise<unknown>;
  readonly markMainWindowReady?: () => Promise<unknown>;
  readonly setOnboardingMode?: (compact: boolean) => Promise<unknown>;
  readonly desktopTauri?: boolean;
  readonly macDesktopTauri?: boolean;
  readonly webApp?: boolean;
}

export interface LaunchIntroInput {
  /** Set in a team window, which shows neither intro nor onboarding. */
  readonly teamWindowTeamId: string | null;
  readonly companionMode: boolean;
  /** A session or account request is in flight. */
  readonly loading: boolean;
  /** The stored session has not been exchanged yet. */
  readonly restoringSession: boolean;
  /** The initial onboarding gate owns the screen, so the window shrinks. */
  readonly showsInitialOnboarding: boolean;
  readonly deps?: LaunchIntroDeps;
}

export interface LaunchIntro {
  readonly isLaunchIntroVisible: boolean;
  /** The intro was opened to be looked at rather than because it is due. */
  readonly previewsLaunchIntro: boolean;
  readonly completeLaunchIntro: () => void;
}

export function useLaunchIntro({
  companionMode,
  deps,
  loading,
  restoringSession,
  showsInitialOnboarding,
  teamWindowTeamId,
}: LaunchIntroInput): LaunchIntro {
  const prepareLaunchIntro = deps?.prepareLaunchIntro ??
    (() => commands.prepareLaunchIntro());
  const showMainWindow = deps?.showMainWindow ??
    (() => commands.showMainWindow());
  const markMainWindowReady = deps?.markMainWindowReady ??
    (() => commands.markMainWindowReady());
  const setOnboardingMode = deps?.setOnboardingMode ??
    ((compact: boolean) => commands.setMainWindowOnboardingMode(compact));
  const runsOnDesktopTauri = deps?.desktopTauri ?? isDesktopTauri();
  const runsOnWeb = deps?.webApp ?? isWebApp();
  // Preview changes the timing, not the macOS presentation surface.
  const usesNativeLaunchIntro = deps?.macDesktopTauri ?? isMacDesktopTauri();
  const previewsLaunchIntro = isLaunchIntroPreview();
  const [isLaunchIntroVisible, setIsLaunchIntroVisible] = useState(
    () =>
      !runsOnWeb &&
      !teamWindowTeamId &&
      !usesNativeLaunchIntro &&
      (previewsLaunchIntro || shouldShowLaunchIntro()),
  );
  const hasCompactedWindowForOnboarding = useRef(false);

  // The main window is created hidden. On a first launch Rust already opened
  // the intro before this bundle finished downloading, so `prepareLaunchIntro`
  // is a no-op here and the reveal path owns the first show; otherwise this is
  // what puts the window on screen.
  useEffect(() => {
    if (!runsOnDesktopTauri || teamWindowTeamId) return;
    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      const shouldPrepareLaunchIntro =
        usesNativeLaunchIntro && shouldShowLaunchIntro();
      try {
        if (shouldPrepareLaunchIntro) {
          await prepareLaunchIntro();
          markLaunchIntroSeen();
        } else {
          await showMainWindow();
        }
      } catch (error) {
        console.error("Failed to prepare the native launch experience", error);
        await showMainWindow().catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teamWindowTeamId, runsOnDesktopTauri, usesNativeLaunchIntro]);

  useEffect(() => {
    if (
      !runsOnDesktopTauri ||
      teamWindowTeamId ||
      companionMode ||
      loading
    ) return;
    const compact = showsInitialOnboarding;
    if (!compact && !hasCompactedWindowForOnboarding.current) return;
    hasCompactedWindowForOnboarding.current = compact;

    void setOnboardingMode(compact).catch((error) => {
      console.error("Failed to resize the Briar onboarding window", error);
    });
  }, [
    companionMode,
    loading,
    teamWindowTeamId,
    runsOnDesktopTauri,
    showsInitialOnboarding,
  ]);

  // Tells Rust the window is worth showing: the session restore settled, so
  // this render is the dashboard or the login/onboarding screen rather than
  // the loading spinner. The intro's reveal is parked until this lands.
  //
  // Declared after the onboarding resize so the window is already at its final
  // size by the time the reveal can act on it.
  useEffect(() => {
    if (!runsOnDesktopTauri || teamWindowTeamId) return;
    if (restoringSession) return;
    void markMainWindowReady().catch((error) => {
      console.error("Failed to report Briar window readiness", error);
    });
  }, [restoringSession, teamWindowTeamId, runsOnDesktopTauri]);

  const completeLaunchIntro = useCallback(() => {
    clearLaunchIntroPreview();
    markLaunchIntroSeen();
    setIsLaunchIntroVisible(false);
  }, []);

  return { completeLaunchIntro, isLaunchIntroVisible, previewsLaunchIntro };
}
