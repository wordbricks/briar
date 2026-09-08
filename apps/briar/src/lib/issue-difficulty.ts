export const issueDifficulties = ["easy", "normal", "hard"] as const;

export type IssueDifficulty = (typeof issueDifficulties)[number];

export const defaultIssueDifficulty: IssueDifficulty = "normal";
