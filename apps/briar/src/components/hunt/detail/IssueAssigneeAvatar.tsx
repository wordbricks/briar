import type { OrganizationMember } from "@/types";
export function IssueAssigneeAvatar({
  member
}: {
  member: OrganizationMember;
}) {
  return member.image ? <img alt="" className="issue-assignee-avatar" src={member.image} /> : <span aria-hidden="true" className="issue-assignee-avatar fallback">
      {member.name.trim().charAt(0).toUpperCase() || "?"}
    </span>;
}
