import { squareImageDataUrlFromFile } from "./square-image";

export const organizationLogoAccept = "image/jpeg,image/png,image/webp";
export const maxWorkspaceLogoSourceBytes = 10 * 1024 * 1024;
export const maxWorkspaceLogoDataUrlLength = 400_000;

export async function organizationLogoFromFile(file: File): Promise<string> {
  return squareImageDataUrlFromFile(file, {
    maxSourceBytes: maxWorkspaceLogoSourceBytes,
    maxDataUrlLength: maxWorkspaceLogoDataUrlLength,
    errors: {
      invalidSource: "invalid-workspace-logo",
      invalidImage: "invalid-workspace-logo-image",
      canvasUnavailable: "workspace-logo-canvas-unavailable",
      invalidOutput: "invalid-workspace-logo-output",
    },
  });
}
