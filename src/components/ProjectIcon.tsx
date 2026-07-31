import { FolderGit2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Project } from "../types";

export function ProjectIcon({
  className,
  project,
}: {
  className?: string;
  project: Pick<Project, "icon" | "name">;
}) {
  return project.icon ? (
    <img
      alt=""
      className={cn("shrink-0 rounded-sm object-contain", className)}
      src={project.icon}
    />
  ) : (
    <FolderGit2
      aria-hidden="true"
      className={cn("shrink-0", className)}
      size={16}
      strokeWidth={1.7}
    />
  );
}
