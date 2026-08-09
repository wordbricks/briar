const defaultSupportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type SquareImageErrors = {
  invalidSource: string;
  invalidImage: string;
  canvasUnavailable: string;
  invalidOutput: string;
};

export type SquareImageOptions = {
  maxSourceBytes: number;
  maxDataUrlLength: number;
  errors: SquareImageErrors;
  size?: number;
  supportedTypes?: ReadonlySet<string>;
};

export function isSquareImageDataUrl(
  value: string,
  maxDataUrlLength: number,
): boolean {
  return (
    /^data:image\/(?:jpeg|png|webp);base64,/u.test(value) &&
    value.length <= maxDataUrlLength
  );
}

export async function squareImageDataUrlFromFile(
  file: File,
  options: SquareImageOptions,
): Promise<string> {
  const supportedTypes = options.supportedTypes ?? defaultSupportedImageTypes;
  if (!supportedTypes.has(file.type) || file.size > options.maxSourceBytes) {
    throw new Error(options.errors.invalidSource);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl, options.errors.invalidImage);
    const size = options.size ?? 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(options.errors.canvasUnavailable);

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
      size,
      size,
    );

    const result = canvas.toDataURL("image/webp", 0.86);
    if (!isSquareImageDataUrl(result, options.maxDataUrlLength)) {
      throw new Error(options.errors.invalidOutput);
    }
    return result;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(
  source: string,
  invalidImageError: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(invalidImageError));
    image.src = source;
  });
}
