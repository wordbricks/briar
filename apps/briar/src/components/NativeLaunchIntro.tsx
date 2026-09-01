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

  const revealMainWindow = useCallback(() => {
    void commands.revealMainWindow().catch((error) => {
      console.error("Failed to reveal the Briar window", error);
    });
  }, []);

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
