const configuredApiUrl = import.meta.env.VITE_BRIAR_API_URL?.trim();
export const briarWebAppOrigin =
  import.meta.env.VITE_BRIAR_WEB === "true" &&
  typeof window !== "undefined" &&
  /^https?:$/u.test(window.location.protocol)
    ? window.location.origin
    : "";

export const briarApiUrl = (configuredApiUrl || briarWebAppOrigin).replace(/\/$/u, "");

// Browser authentication uses cookies, so keep it on the web app origin.
// Bearer-authenticated Connect clients continue to use the configured API origin.
export const briarAuthUrl = briarWebAppOrigin || briarApiUrl;
