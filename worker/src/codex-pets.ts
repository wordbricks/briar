import { z } from "zod";

const catalogUrl =
  "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets.json";
const rawRepositoryUrl =
  "https://raw.githubusercontent.com/legeling/awesome-codex-pet/main";
const maxSpriteSheetBytes = 10 * 1024 * 1024;
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/u);
const catalogEntrySchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(200),
  license: z.string().trim().min(1).max(1_000),
  spriteVersionNumber: z.union([z.literal(1), z.literal(2)]).optional(),
});

export type StoredCodexPet = {
  slug: string;
  name: string;
  author: string;
  license: string;
  spriteVersion: 1 | 2;
};

export async function fetchCodexPet(
  slugInput: string,
  fetcher: typeof fetch = fetch,
): Promise<{
  metadata: StoredCodexPet;
  spriteSheet: ArrayBuffer;
  etag: string | null;
}> {
  const slug = slugSchema.parse(slugInput);
  const catalogResponse = await fetcher(catalogUrl, {
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!catalogResponse.ok) {
    throw new Error("codex-pet-catalog-unavailable");
  }
  const catalog = z
    .array(catalogEntrySchema)
    .parse(await catalogResponse.json());
  const pet = catalog.find((entry) => entry.slug === slug);
  if (!pet) throw new Error("codex-pet-not-found");

  const spriteResponse = await fetcher(
    `${rawRepositoryUrl}/pets/${slug}/spritesheet.webp`,
    { cf: { cacheEverything: true, cacheTtl: 300 } },
  );
  const contentType = spriteResponse.headers.get("content-type");
  const declaredSize = Number(
    spriteResponse.headers.get("content-length") ?? "0",
  );
  if (
    !spriteResponse.ok ||
    !contentType?.startsWith("image/webp") ||
    declaredSize > maxSpriteSheetBytes
  ) {
    throw new Error("codex-pet-spritesheet-unavailable");
  }
  const spriteSheet = await spriteResponse.arrayBuffer();
  if (spriteSheet.byteLength > maxSpriteSheetBytes) {
    throw new Error("codex-pet-spritesheet-too-large");
  }
  return {
    metadata: {
      slug: pet.slug,
      name: pet.name,
      author: pet.author,
      license: pet.license,
      spriteVersion: pet.spriteVersionNumber ?? 1,
    },
    spriteSheet,
    etag: spriteResponse.headers.get("etag"),
  };
}

export function codexPetSpriteSheetObjectKey(
  projectId: string,
  agentId: string,
  slug: string,
) {
  return `project-agent-spritesheets/${projectId}/${agentId}/${crypto.randomUUID()}-${slug}.webp`;
}
