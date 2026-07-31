export const projectIconAccept =
  "image/jpeg,image/png,image/webp,image/svg+xml,image/x-icon,.ico";
export const maxProjectIconSourceBytes = 10 * 1024 * 1024;
export const maxProjectIconDataUrlLength = 400_000;

const iconSize = 256;
const supportedProjectIconTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export function isProjectIconDataUrl(value: string): boolean {
  return (
    /^data:image\/webp;base64,/u.test(value) &&
    value.length <= maxProjectIconDataUrlLength
  );
}

export async function projectIconFromFile(file: File): Promise<string> {
  const extension = file.name.toLocaleLowerCase().split(".").pop();
  if (
    (!supportedProjectIconTypes.has(file.type) && extension !== "ico") ||
    file.size > maxProjectIconSourceBytes
  ) {
    throw new Error("invalid-project-icon");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await renderProjectIcon(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function projectIconFromDataUrl(source: string): Promise<string> {
  if (
    !/^data:image\/(?:jpeg|png|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/iu.test(
      source,
    ) ||
    source.length > Math.ceil((maxProjectIconSourceBytes * 4) / 3) + 100
  ) {
    throw new Error("invalid-project-icon-source");
  }
  return renderProjectIcon(source);
}

async function renderProjectIcon(source: string): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = iconSize;
  canvas.height = iconSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("project-icon-canvas-unavailable");

  const sourceWidth = image.naturalWidth || iconSize;
  const sourceHeight = image.naturalHeight || iconSize;
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = (sourceWidth - cropSize) / 2;
  const sourceY = (sourceHeight - cropSize) / 2;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    iconSize,
    iconSize,
  );

  const icon = canvas.toDataURL("image/webp", 0.86);
  if (!isProjectIconDataUrl(icon)) {
    throw new Error("invalid-project-icon-output");
  }
  return icon;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid-project-icon-image"));
    image.src = source;
  });
}
