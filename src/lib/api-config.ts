const configuredApiUrl = import.meta.env.VITE_BRIAR_API_URL?.trim();
export const briarWebAppOrigin =
  import.meta.env.VITE_BRIAR_WEB === "true" &&
  typeof window !== "undefined" &&
  /^https?:$/u.test(window.location.protocol)
    ? window.location.origin
    : "";

export const briarApiUrl = (configuredApiUrl || briarWebAppOrigin).replace(/\/$/u, "");
