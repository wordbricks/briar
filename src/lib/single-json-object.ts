export type ExtractedJsonObject = {
  text: string;
  value: Record<string, unknown>;
};

/**
 * Finds exactly one complete, standalone JSON object in conversational text.
 * Nested objects stay part of their outer object, object-shaped prose is
 * ignored, and multiple valid objects fail closed.
 */
export function extractSingleJsonObject(
  raw: string,
): ExtractedJsonObject | null {
  const trimmed = raw.trim();
  const objects: ExtractedJsonObject[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const text = trimmed.slice(start, index + 1);
        const previous = trimmed.slice(0, start).trimEnd().at(-1);
        const next = trimmed.slice(index + 1).trimStart().at(0);
        const nestedInArray =
          (previous === "[" || previous === ",") &&
          (next === "]" || next === ",");
        try {
          const parsed = JSON.parse(text);
          if (
            !nestedInArray && parsed && typeof parsed === "object" &&
            !Array.isArray(parsed)
          ) {
            objects.push({
              text,
              value: parsed as Record<string, unknown>,
            });
          }
        } catch {
          // Balanced prose braces are not JSON candidates.
        }
        start = -1;
      }
    }
  }
  return objects.length === 1 ? objects[0] : null;
}
