/**
 * Briar type scale — single reference for JS/TS consumers.
 * CSS counterparts live in `src/styles/tokens.css`.
 */
export const typeScale = {
  "2xs": { size: "0.625rem", lineHeight: "1rem", px: 10 },
  xs: { size: "0.6875rem", lineHeight: "1rem", px: 11 },
  sm: { size: "0.75rem", lineHeight: "1.125rem", px: 12 },
  base: { size: "0.8125rem", lineHeight: "1.25rem", px: 13 },
  md: { size: "0.875rem", lineHeight: "1.375rem", px: 14 },
  lg: { size: "1rem", lineHeight: "1.5rem", px: 16 },
  xl: { size: "1.125rem", lineHeight: "1.5rem", px: 18 },
  "2xl": { size: "1.375rem", lineHeight: "1.75rem", px: 22 },
  "3xl": { size: "1.75rem", lineHeight: "2rem", px: 28 },
  "4xl": { size: "2.125rem", lineHeight: "2.375rem", px: 34 },
} as const;

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Semantic roles → scale steps */
export const typeRoles = {
  display: "4xl",
  title: "3xl",
  heading: "2xl",
  subheading: "xl",
  bodyLg: "md",
  body: "base",
  bodySm: "sm",
  label: "sm",
  caption: "xs",
  micro: "2xs",
} as const;

export type TypeStep = keyof typeof typeScale;
export type TypeRole = keyof typeof typeRoles;
