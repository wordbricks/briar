const authClientOrigins = [
  "https://briar.wordbricks.ai",
  "http://localhost:1420",
  "tauri://localhost",
  "http://tauri.localhost",
] as const;

export const trustedAuthOrigins = (apiOrigin: string) => [
  apiOrigin,
  ...authClientOrigins,
];

export const isTrustedAuthOrigin = (
  origin: string,
  apiOrigin: string,
) => trustedAuthOrigins(apiOrigin).includes(origin);
