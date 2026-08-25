function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export { enabled };
