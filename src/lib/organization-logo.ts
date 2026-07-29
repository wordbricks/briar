export const organizationLogoAccept = "image/jpeg,image/png,image/webp";
export const maxOrganizationLogoSourceBytes = 10 * 1024 * 1024;
export const maxOrganizationLogoDataUrlLength = 400_000;

const logoSize = 256;
const supportedLogoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isOrganizationLogoDataUrl(value: string): boolean {
  return (
    /^data:image\/(?:jpeg|png|webp);base64,/u.test(value) &&
    value.length <= maxOrganizationLogoDataUrlLength
  );
}

export async function organizationLogoFromFile(file: File): Promise<string> {
  if (
    !supportedLogoTypes.has(file.type) ||
    file.size > maxOrganizationLogoSourceBytes
  ) {
    throw new Error("invalid-organization-logo");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = logoSize;
    canvas.height = logoSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("organization-logo-canvas-unavailable");

    const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - cropSize) / 2;
    const sourceY = (image.naturalHeight - cropSize) / 2;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      logoSize,
      logoSize,
    );

    const logo = canvas.toDataURL("image/webp", 0.86);
    if (!isOrganizationLogoDataUrl(logo)) {
      throw new Error("invalid-organization-logo-output");
    }
    return logo;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid-organization-logo-image"));
    image.src = source;
  });
}
