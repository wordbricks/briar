import { expect, it } from "vitest";
import { publicOrganizationInvitationJson } from "./organization-json";

it("exposes an invitation role without exposing its email", () => {
  const invitation = publicOrganizationInvitationJson({
    id: "invite-1",
    organization_id: "organization-1",
    organization_name: "Example",
    initial_project_id: "project-1",
    initial_project_name: "Starting Project",
    email_normalized: "private@example.com",
    role: "editor",
    invited_by_user_id: "owner-1",
    expires_at: "2026-09-05T00:00:00.000Z",
    accepted_at: null,
    accepted_by_user_id: null,
    revoked_at: null,
    created_at: "2026-08-29T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
  }, "2026-08-29T00:01:00.000Z");

  expect(invitation).toMatchObject({
    role: "editor",
    emailHint: "p***@example.com",
  });
  expect(invitation).not.toHaveProperty("email");
});
