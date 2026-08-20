import type { Project } from "../types";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { isDesktopTauri } from "./platform";

export const projectWindowQueryParameter = "projectWindow";

export function readProjectWindowProjectId(search?: string) {
  if (typeof window === "undefined" && search === undefined) return null;
  const value = new URLSearchParams(
    search ?? window.location.search,
  ).get(projectWindowQueryParameter)?.trim();
  return value || null;
}

export function projectWindowUrl(
  projectId: string,
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
) {
  const search = new URLSearchParams(location.search);
  search.set(projectWindowQueryParameter, projectId);
  return `${location.pathname}?${search.toString()}${location.hash}`;
}

export function projectWindowLabel(projectId: string, nonce = Date.now()) {
  const safeProjectId = projectId
    .replace(/[^a-zA-Z0-9-/:_]/gu, "-")
    .slice(0, 64) || "project";
  return `project-${safeProjectId}-${nonce.toString(36)}`;
}

export async function openProjectWindow(project: Project) {
  if (!isDesktopTauri()) {
    throw new Error("Project windows are only available in the desktop app.");
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const projectWindow = new WebviewWindow(projectWindowLabel(project.id), {
    backgroundColor: "#f7f7f3",
    center: true,
    height: 820,
    hiddenTitle: true,
    minHeight: 680,
    minWidth: 980,
    title: project.name,
    titleBarStyle: "overlay",
    trafficLightPosition: new LogicalPosition(16, 22),
    url: projectWindowUrl(project.id),
    width: 1280,
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
