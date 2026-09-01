import {
  authEmailSenderFromEnv,
  handleAuthRequest,
  type BriarAuth,
} from "./auth";
import { withCredentialedAuthCorsHeaders } from "./http-response";

export type AccountRouteInput = {
  request: Request;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
};

/** Better Auth owns its browser/device HTTP protocol outside Connect. */
export async function handleAccountRoute(
  { request, auth, db, env }: AccountRouteInput,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/auth/")) return undefined;

  const response = await handleAuthRequest(
    request,
    auth,
    db,
    env.BETTER_AUTH_SECRET,
    Boolean(authEmailSenderFromEnv(env)),
  );
  return withCredentialedAuthCorsHeaders(request, response);
}
