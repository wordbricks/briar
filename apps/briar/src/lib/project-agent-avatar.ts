import {
  isSquareImageDataUrl,
  squareImageDataUrlFromFile,
} from "./square-image";

export const projectAgentAvatarAccept = "image/jpeg,image/png,image/webp";
export const maxProjectAgentAvatarSourceBytes = 10 * 1024 * 1024;
export const maxProjectAgentAvatarDataUrlLength = 400_000;

export function isProjectAgentAvatarDataUrl(value: string): boolean {
  return isSquareImageDataUrl(value, maxProjectAgentAvatarDataUrlLength);
}

export async function projectAgentAvatarFromFile(file: File): Promise<string> {
  return squareImageDataUrlFromFile(file, {
    maxSourceBytes: maxProjectAgentAvatarSourceBytes,
    maxDataUrlLength: maxProjectAgentAvatarDataUrlLength,
    errors: {
      invalidSource: "invalid-avatar",
      invalidImage: "invalid-avatar-image",
      canvasUnavailable: "avatar-canvas-unavailable",
      invalidOutput: "invalid-avatar-output",
    },
  });
}
