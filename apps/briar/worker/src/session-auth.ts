import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";

export async function requireSession(auth: BriarAuth, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new HttpError(401, "Unauthorized");
  return session;
}

