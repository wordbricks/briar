export const projectAgentAvatarAccept = "image/jpeg,image/png,image/webp";
export const maxProjectAgentAvatarSourceBytes = 10 * 1024 * 1024;
export const maxProjectAgentAvatarDataUrlLength = 400_000;

const avatarSize = 256;
const supportedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isProjectAgentAvatarDataUrl(value: string): boolean {
  return (
    /^data:image\/(?:jpeg|png|webp);base64,/u.test(value) &&
    value.length <= maxProjectAgentAvatarDataUrlLength
  );
}

export async function projectAgentAvatarFromFile(file: File): Promise<string> {
  if (
    !supportedAvatarTypes.has(file.type) ||
    file.size > maxProjectAgentAvatarSourceBytes
  ) {
    throw new Error("invalid-avatar");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = avatarSize;
    canvas.height = avatarSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("avatar-canvas-unavailable");

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
      avatarSize,
      avatarSize,
    );

    const avatar = canvas.toDataURL("image/webp", 0.86);
    if (!isProjectAgentAvatarDataUrl(avatar)) {
      throw new Error("invalid-avatar-output");
    }
    return avatar;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid-avatar-image"));
    image.src = source;
  });
}
