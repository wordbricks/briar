function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export const featureFlags = Object.freeze({});

export { enabled };
