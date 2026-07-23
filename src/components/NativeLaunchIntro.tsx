import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import {
  clearLaunchIntroPreview,
  isLaunchIntroPreview,
  markLaunchIntroSeen,
} from "../lib/launch-intro";
import { LaunchIntro } from "./LaunchIntro";

export function NativeLaunchIntro() {
  const isCompleting = useRef(false);

  const revealMainWindow = useCallback(() => {
    void invoke("reveal_main_window").catch((error) => {
      console.error("Failed to reveal the Briar window", error);
    });
  }, []);

  const finishIntro = useCallback(() => {
    if (isCompleting.current) return;
    isCompleting.current = true;
    clearLaunchIntroPreview();
    markLaunchIntroSeen();
    void invoke("finish_launch_intro").catch(async (error) => {
      console.error("Failed to finish the native launch intro", error);
      await invoke("show_main_window").catch(() => undefined);
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
