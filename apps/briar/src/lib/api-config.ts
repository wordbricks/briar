const configuredApiUrl = import.meta.env.VITE_BRIAR_API_URL?.trim();
export const briarWebAppOrigin =
  import.meta.env.VITE_BRIAR_WEB === "true" &&
  typeof window !== "undefined" &&
  /^https?:$/u.test(window.location.protocol)
    ? window.location.origin
    : "";

// Keep browser API calls first-party so Better Auth's HttpOnly session cookie
// authenticates the app without exposing a bearer token to JavaScript storage.
// The Worker removes this route prefix before dispatching the API request.
export const briarApiUrl = (
  briarWebAppOrigin ? `${briarWebAppOrigin}/app-api` : configuredApiUrl || ""
).replace(/\/$/u, "");

// Browser authentication uses cookies, so keep it on the web app origin.
// Bearer-authenticated Connect clients continue to use the configured API origin.
export const briarAuthUrl = briarWebAppOrigin || briarApiUrl;
