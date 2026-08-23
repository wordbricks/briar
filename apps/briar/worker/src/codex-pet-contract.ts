import * as Schema from "effect/Schema";
import { trimmedText } from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const CodexPetSlug = Schema.String.check(
  Schema.isPattern(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/u,
  ),
);

export const CodexPetCatalogEntry = Schema.Struct({
  slug: CodexPetSlug,
  name: trimmedText(1, 200),
  author: trimmedText(1, 200),
  license: trimmedText(1, 1_000),
  spriteVersionNumber: Schema.optional(Schema.Literals([1, 2])),
});

export const CodexPetCatalog = Schema.Array(CodexPetCatalogEntry);

export type CodexPetCatalogEntry = typeof CodexPetCatalogEntry.Type;

export const decodeCodexPetSlug = decodeRequestSync(CodexPetSlug);

export const decodeCodexPetCatalog = decodeRequestSync(CodexPetCatalog);
