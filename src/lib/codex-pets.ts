export const codexPetCatalogUrl =
  "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json";
export const codexPetSiteUrl = "https://codexpet.top";
export const maxCodexPetSpriteSheetBytes = 10 * 1024 * 1024;

const codexPetRepositoryRawUrl =
  "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main";
const codexPetSlugPattern =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/u;

export type CodexPetCatalogEntry = {
  slug: string;
  name: string;
  localizedNames: Record<string, string>;
  author: string;
  authorUrl: string | null;
  category: string;
  license: string;
  description: string | null;
  spriteVersion: 1 | 2;
};

export type ProjectAgentCodexPet = Pick<
  CodexPetCatalogEntry,
  "slug" | "name" | "author" | "license" | "spriteVersion"
> & {
  spriteSheetUrl: string | null;
};

export async function loadCodexPetCatalog(
  signal?: AbortSignal,
): Promise<CodexPetCatalogEntry[]> {
  const response = await fetch(codexPetCatalogUrl, { signal });
  if (!response.ok) throw new Error("codex-pet-catalog-unavailable");
  const catalog = await response.json();
  if (!Array.isArray(catalog)) throw new Error("invalid-codex-pet-catalog");
  return catalog.map(parseCatalogEntry);
}

export function codexPetPageUrl(slug: string) {
  assertCodexPetSlug(slug);
  return `${codexPetSiteUrl}/pets/${slug}`;
}

export function codexPetThumbnailUrl(slug: string) {
  assertCodexPetSlug(slug);
  return `${codexPetSiteUrl}/assets/previews/${slug}/thumbnail.png`;
}

export function codexPetSpriteSheetSourceUrl(slug: string) {
  assertCodexPetSlug(slug);
  return `${codexPetRepositoryRawUrl}/pets/${slug}/spritesheet.webp`;
}

export async function projectAgentAvatarFromCodexPet(
  pet: CodexPetCatalogEntry,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(codexPetSpriteSheetSourceUrl(pet.slug), {
    signal,
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("image/webp")
  ) {
    throw new Error("codex-pet-spritesheet-unavailable");
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > maxCodexPetSpriteSheetBytes) {
    throw new Error("codex-pet-spritesheet-too-large");
  }
  const blob = await response.blob();
  if (blob.size > maxCodexPetSpriteSheetBytes) {
    throw new Error("codex-pet-spritesheet-too-large");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    const expectedHeight = pet.spriteVersion === 2 ? 2_288 : 1_872;
    if (
      image.naturalWidth !== 1_536 ||
      image.naturalHeight !== expectedHeight
    ) {
      throw new Error("invalid-codex-pet-spritesheet");
    }
    return avatarFromFirstSpriteFrame(image);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function parseCatalogEntry(value: unknown): CodexPetCatalogEntry {
  if (!value || typeof value !== "object") {
    throw new Error("invalid-codex-pet-catalog");
  }
  const entry = value as Record<string, unknown>;
  const slug = requiredString(entry.slug);
  assertCodexPetSlug(slug);
  const spriteVersion = entry.spriteVersionNumber === 2 ? 2 : 1;
  const localizedNames =
    entry.localized_names && typeof entry.localized_names === "object"
      ? Object.fromEntries(
          Object.entries(entry.localized_names).filter(
            (item): item is [string, string] => typeof item[1] === "string",
          ),
        )
      : {};
  return {
    slug,
    name: requiredString(entry.name),
    localizedNames,
    author: requiredString(entry.author),
    authorUrl: typeof entry.author_url === "string" ? entry.author_url : null,
    category: requiredString(entry.primary_category),
    license: requiredString(entry.license),
    description:
      typeof entry.description === "string" ? entry.description : null,
    spriteVersion,
  };
}

function avatarFromFirstSpriteFrame(image: HTMLImageElement): string {
  const frameWidth = 192;
  const frameHeight = 208;
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = frameWidth;
  sourceCanvas.height = frameHeight;
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext) throw new Error("avatar-canvas-unavailable");
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(
    image,
    0,
    0,
    frameWidth,
    frameHeight,
    0,
    0,
    frameWidth,
    frameHeight,
  );

  const pixels = sourceContext.getImageData(0, 0, frameWidth, frameHeight);
  const bounds = opaquePixelBounds(pixels);
  const avatarSize = 256;
  const padding = 20;
  const canvas = document.createElement("canvas");
  canvas.width = avatarSize;
  canvas.height = avatarSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("avatar-canvas-unavailable");
  context.imageSmoothingEnabled = false;

  const contentWidth = bounds.right - bounds.left + 1;
  const contentHeight = bounds.bottom - bounds.top + 1;
  const scale = Math.min(
    (avatarSize - padding * 2) / contentWidth,
    (avatarSize - padding * 2) / contentHeight,
  );
  const width = Math.max(1, Math.round(contentWidth * scale));
  const height = Math.max(1, Math.round(contentHeight * scale));
  context.drawImage(
    sourceCanvas,
    bounds.left,
    bounds.top,
    contentWidth,
    contentHeight,
    Math.round((avatarSize - width) / 2),
    Math.round((avatarSize - height) / 2),
    width,
    height,
  );

  const avatar = canvas.toDataURL("image/webp", 0.9);
  if (!/^data:image\/webp;base64,/u.test(avatar) || avatar.length > 400_000) {
    throw new Error("invalid-avatar-output");
  }
  return avatar;
}

export function opaquePixelBounds(image: ImageData) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) {
    throw new Error("empty-codex-pet-frame");
  }
  return { left, top, right, bottom };
}

function assertCodexPetSlug(slug: string) {
  if (!codexPetSlugPattern.test(slug)) {
    throw new Error("invalid-codex-pet-slug");
  }
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("invalid-codex-pet-catalog");
  }
  return value.trim();
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("invalid-codex-pet-image"));
    image.src = source;
  });
}
