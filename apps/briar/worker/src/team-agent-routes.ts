import type { BriarAuth } from "./auth";
import { corsHeaders, HttpError } from "./http-response";
import { getTeamAgent } from "./team-agent-repository";
import { getTeam } from "./team-command-repository";
import { requireSession } from "./session-auth";

export type TeamAgentRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
};

/** Binary Codex Pet asset endpoint; Agent data and mutations use Connect. */
export async function handleTeamAgentRoute(
  routeInput: TeamAgentRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, attachmentsBucket } = routeInput;
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agents\/([0-9a-f-]+)\/spritesheet$/u,
  );
  if (!match || request.method !== "GET") return undefined;

  const session = await requireSession(auth, request);
  const project = await getTeam(db, match[1], session.user.id);
  if (!project) throw new HttpError(404, "Project not found");
  const agent = await getTeamAgent(db, project.id, match[2]);
  if (!agent?.avatar_spritesheet_object_key) {
    throw new HttpError(404, "Agent sprite sheet not found");
  }
  const object = await attachmentsBucket.get(agent.avatar_spritesheet_object_key);
  if (!object) throw new HttpError(404, "Agent sprite sheet not found");
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", "image/webp");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
