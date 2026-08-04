function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export const featureFlags = Object.freeze({
  ideas: enabled(import.meta.env.VITE_BRIAR_FEATURE_IDEAS),
});
