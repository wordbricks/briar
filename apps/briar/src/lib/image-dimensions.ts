export type ImageDimensions = { width: number; height: number };

/*
  A decode that never answers must not hold a message back, so the optimistic
  echo waits only this long. Giving up costs the row its exact reservation and
  leaves the fixed fallback in place, which is still stable across the load.
*/
export const optimisticDimensionTimeoutMs = 250;

function measureImageSource(source: string): Promise<ImageDimensions | null> {
  if (typeof Image === "undefined" || !source) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null);
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function withDimensionTimeout(
  pending: Promise<ImageDimensions | null>,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/*
  Attachment rows reserve their height from these numbers before the picture is
  on screen, so the upload metadata and the optimistic message that precedes it
  have to agree on them.
*/
export function readImageDimensions(
  file: File,
): Promise<ImageDimensions | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  if (typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  const url = URL.createObjectURL(file);
  return measureImageSource(url).finally(() => URL.revokeObjectURL(url));
}

/*
  Measures the object URLs the sender already created, rather than minting new
  ones: the sender keeps those URLs alive for the whole optimistic message, and
  releasing a duplicate would take the picture down with it.
*/
export function readAttachmentDimensions(
  attachments: readonly { contentType: string; source: string }[],
  timeoutMs = optimisticDimensionTimeoutMs,
) {
  return Promise.all(attachments.map((attachment) =>
    attachment.contentType.startsWith("image/")
      ? withDimensionTimeout(
          measureImageSource(attachment.source),
          timeoutMs,
        )
      : Promise.resolve(null)
  ));
}
