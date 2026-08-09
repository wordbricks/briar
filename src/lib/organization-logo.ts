import {
  isSquareImageDataUrl,
  squareImageDataUrlFromFile,
} from "./square-image";

export const organizationLogoAccept = "image/jpeg,image/png,image/webp";
export const maxOrganizationLogoSourceBytes = 10 * 1024 * 1024;
export const maxOrganizationLogoDataUrlLength = 400_000;

export function isOrganizationLogoDataUrl(value: string): boolean {
  return isSquareImageDataUrl(value, maxOrganizationLogoDataUrlLength);
}

export async function organizationLogoFromFile(file: File): Promise<string> {
  return squareImageDataUrlFromFile(file, {
    maxSourceBytes: maxOrganizationLogoSourceBytes,
    maxDataUrlLength: maxOrganizationLogoDataUrlLength,
    errors: {
      invalidSource: "invalid-organization-logo",
      invalidImage: "invalid-organization-logo-image",
      canvasUnavailable: "organization-logo-canvas-unavailable",
      invalidOutput: "invalid-organization-logo-output",
    },
  });
}
