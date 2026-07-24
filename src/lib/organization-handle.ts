export const organizationHandlePattern = /^[a-z0-9-]+$/u;

export function organizationHandleFromName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);
}

export function isValidOrganizationHandle(handle: string) {
  return (
    handle.length >= 1 &&
    handle.length <= 63 &&
    organizationHandlePattern.test(handle)
  );
}
