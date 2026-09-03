import {
  isSquareImageDataUrl,
  squareImageDataUrlFromFile,
} from "./square-image";

export const teamAgentAvatarAccept = "image/jpeg,image/png,image/webp";
export const maxTeamAgentAvatarSourceBytes = 10 * 1024 * 1024;
export const maxTeamAgentAvatarDataUrlLength = 400_000;

export function isTeamAgentAvatarDataUrl(value: string): boolean {
  return isSquareImageDataUrl(value, maxTeamAgentAvatarDataUrlLength);
}

export async function teamAgentAvatarFromFile(file: File): Promise<string> {
  return squareImageDataUrlFromFile(file, {
    maxSourceBytes: maxTeamAgentAvatarSourceBytes,
    maxDataUrlLength: maxTeamAgentAvatarDataUrlLength,
    errors: {
      invalidSource: "invalid-avatar",
      invalidImage: "invalid-avatar-image",
      canvasUnavailable: "avatar-canvas-unavailable",
      invalidOutput: "invalid-avatar-output",
    },
  });
}
