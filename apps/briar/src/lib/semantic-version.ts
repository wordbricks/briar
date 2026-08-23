const semanticVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/u;

export function compareSemanticVersions(left: string, right: string): number {
  const leftMatch = left.match(semanticVersionPattern);
  const rightMatch = right.match(semanticVersionPattern);
  if (!leftMatch || !rightMatch) {
    throw new Error(`Invalid semantic version: ${!leftMatch ? left : right}`);
  }
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function isSemanticVersion(value: string): boolean {
  return semanticVersionPattern.test(value);
}
