import type { Project } from "../types";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Effect, EffectState } from "@tauri-apps/api/window";
import { isDesktopTauri, isMacDesktopTauri } from "./platform";

export const teamWindowQueryParameter = "projectWindow";

export function readTeamWindowProjectId(search?: string) {
  if (typeof window === "undefined" && search === undefined) return null;
  const value = new URLSearchParams(
    search ?? window.location.search,
  ).get(teamWindowQueryParameter)?.trim();
  return value || null;
}

export function teamWindowUrl(
  projectId: string,
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
) {
  const search = new URLSearchParams(location.search);
  search.set(teamWindowQueryParameter, projectId);
  return `${location.pathname}?${search.toString()}${location.hash}`;
}

export function teamWindowLabel(projectId: string, nonce = Date.now()) {
  const safeProjectId = projectId
    .replace(/[^a-zA-Z0-9-/:_]/gu, "-")
    .slice(0, 64) || "project";
  return `project-${safeProjectId}-${nonce.toString(36)}`;
}

export function teamWindowPresentationOptions(isMacOS: boolean) {
  if (!isMacOS) {
    return { backgroundColor: "#f7f7f3" };
  }

  return {
    backgroundColor: "#00000000",
    transparent: true,
    windowEffects: {
      effects: [Effect.Sidebar],
      state: EffectState.FollowsWindowActiveState,
    },
  };
}

export async function openTeamWindow(project: Project) {
  if (!isDesktopTauri()) {
    throw new Error("Project windows are only available in the desktop app.");
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const projectWindow = new WebviewWindow(teamWindowLabel(project.id), {
    center: true,
    height: 820,
    hiddenTitle: true,
    minHeight: 680,
    minWidth: 980,
    title: project.name,
    titleBarStyle: "overlay",
    trafficLightPosition: new LogicalPosition(16, 22),
    url: teamWindowUrl(project.id),
    width: 1280,
    ...teamWindowPresentationOptions(isMacDesktopTauri()),
  });

  await new Promise<void>((resolve, reject) => {
    void Promise.all([
      projectWindow.once("tauri://created", () => resolve()),
      projectWindow.once<unknown>("tauri://error", ({ payload }) => {
        reject(
          payload instanceof Error
            ? payload
            : new Error(
                String(payload ?? "Unable to create the project window."),
              ),
        );
      }),
    ]).catch(reject);
  });
}
