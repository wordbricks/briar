import type { BriarAuth } from "./auth";
import { json } from "./http-response";
import { listWorkspacesApplication } from "./workspace-application";
import type { WorkspaceRow } from "./workspace-repository";
import { teamJson } from "./team-json";
import { listTeams } from "./team-repository";
import { requireSession } from "./session-auth";

const legacyWorkspaceJson = (workspace: WorkspaceRow) => ({
  id: workspace.id,
  name: workspace.name,
  handle: workspace.handle,
  logo: workspace.logo,
  role: workspace.role,
  createdAt: workspace.created_at,
});

// TODO(remove after every Briar 1.2.174 installation has run 1.2.179+ once):
// Delete these three read-only upgrade endpoints. They exist only so the
// 1.2.174 shell can finish session restore and render its signed-update UI.
export async function handleLegacyUpdateBootstrapRoute(input: {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
}): Promise<Response | undefined> {
  const { request, auth, db } = input;
  if (request.method !== "GET") return undefined;
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/me" && pathname !== "/workspaces" && pathname !== "/projects") {
    return undefined;
  }

  const session = await requireSession(auth, request);
  if (pathname === "/me") {
    const { id, username, name, email, image } = session.user;
    return json({ user: { id, username, name, email, image } });
  }
  if (pathname === "/workspaces") {
    const workspaces = await listWorkspacesApplication({
      db,
      userId: session.user.id,
    });
    return json({ workspaces: workspaces.map(legacyWorkspaceJson) });
  }
  const projects = await listTeams(db, session.user.id);
  return json({ projects: projects.map(teamJson) });
}
