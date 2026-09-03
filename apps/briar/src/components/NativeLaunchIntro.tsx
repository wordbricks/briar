import { useCallback, useRef } from "react";
import { commands } from "../generated/tauri";
import {
  clearLaunchIntroPreview,
  isLaunchIntroPreview,
  markLaunchIntroSeen,
} from "../lib/launch-intro";
import { LaunchIntro } from "./LaunchIntro";

export function NativeLaunchIntro() {
  const isCompleting = useRef(false);

  // Resolves once Rust has the main window on screen, which it only does after
  // the frontend reports its first real screen (or the wait cap elapses). The
  // fade is chained onto that promise so the intro never uncovers a spinner.
  const revealMainWindow = useCallback(
    () =>
      commands.revealMainWindow().catch((error) => {
        console.error("Failed to reveal the Briar window", error);
      }),
    [],
  );

  const finishIntro = useCallback(() => {
    if (isCompleting.current) return;
    isCompleting.current = true;
    clearLaunchIntroPreview();
    markLaunchIntroSeen();
    void commands.finishLaunchIntro().catch(async (error) => {
      console.error("Failed to finish the native launch intro", error);
      await commands.showMainWindow().catch(() => undefined);
    });
  }, []);

  return (
    <LaunchIntro
      native
      onComplete={finishIntro}
      onReveal={revealMainWindow}
      preview={isLaunchIntroPreview()}
    />
  );
}
