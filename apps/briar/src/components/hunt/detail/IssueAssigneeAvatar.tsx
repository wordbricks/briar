import type { OrganizationMember } from "@/types";
import { cn } from "@/lib/utils";
export function IssueAssigneeAvatar({
  member
}: {
  member: OrganizationMember;
}) {
  return member.image ? <img alt="" className="issue-assignee-avatar block size-full rounded-[inherit] object-cover" src={member.image} /> : <span aria-hidden="true" className={cn("issue-assignee-avatar fallback grid size-full place-items-center rounded-[inherit] bg-[#7662b7] text-[13px] font-bold text-white")}>
      {member.name.trim().charAt(0).toUpperCase() || "?"}
    </span>;
}
