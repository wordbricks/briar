export const ciContextNames = [
  "app-worker",
  "d1-migrations",
  "rust",
  "security",
] as const;

export type CiContextName = typeof ciContextNames[number];

export type CiOptions = {
  readonly contexts: ReadonlyArray<CiContextName>;
  readonly signoff: boolean;
};
