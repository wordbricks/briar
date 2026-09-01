import type { BriarAuth } from "./auth";
import { json } from "./http-response";
import { listOrganizationsApplication } from "./organization-application";
import type { OrganizationRow } from "./organization-repository";
import { projectJson } from "./project-json";
import { listProjects } from "./project-repository";
import { requireSession } from "./session-auth";

const legacyOrganizationJson = (organization: OrganizationRow) => ({
  id: organization.id,
  name: organization.name,
  handle: organization.handle,
  logo: organization.logo,
  role: organization.role,
  createdAt: organization.created_at,
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
  if (pathname !== "/me" && pathname !== "/organizations" && pathname !== "/projects") {
    return undefined;
  }

  const session = await requireSession(auth, request);
  if (pathname === "/me") {
    const { id, username, name, email, image } = session.user;
    return json({ user: { id, username, name, email, image } });
  }
  if (pathname === "/organizations") {
    const organizations = await listOrganizationsApplication({
      db,
      userId: session.user.id,
    });
    return json({ organizations: organizations.map(legacyOrganizationJson) });
  }
  const projects = await listProjects(db, session.user.id);
  return json({ projects: projects.map(projectJson) });
}
