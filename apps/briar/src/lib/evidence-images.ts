export const evidenceImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
] as const;

export const maxEvidenceImageCount = 5;
export const maxEvidenceImageBytes = 20 * 1024 * 1024;
export const maxEvidenceImageTotalBytes = 25 * 1024 * 1024;

const allowedMimeTypes = new Set<string>(evidenceImageMimeTypes);

export type EvidenceImageCandidate = {
  name: string;
  size: number;
  type: string;
};

export function validateEvidenceImages(
  images: readonly EvidenceImageCandidate[],
): string | null {
  if (images.length > maxEvidenceImageCount) {
    return `Evidence images are limited to ${maxEvidenceImageCount} files.`;
  }
  let totalBytes = 0;
  for (const image of images) {
    const name = image.name.normalize("NFC").trim();
    if (!name || name.length > 255 || name.includes("\0")) {
      return "An evidence image filename is invalid.";
    }
    if (!allowedMimeTypes.has(image.type)) {
      return `${name} is not a supported evidence image format.`;
    }
    if (!Number.isSafeInteger(image.size) || image.size <= 0) {
      return `${name} is empty or has an invalid size.`;
    }
    if (image.size > maxEvidenceImageBytes) {
      return `${name} exceeds the 20MB per-image limit.`;
    }
    totalBytes += image.size;
  }
  if (totalBytes > maxEvidenceImageTotalBytes) {
    return "Evidence images are limited to 25MB in total.";
  }
  return null;
}
