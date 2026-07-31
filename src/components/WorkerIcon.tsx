import { Monitor } from "lucide-react";

import type { WorkerIcon as WorkerIconValue } from "../types";

export function WorkerIcon({
  icon,
  size = 32,
}: {
  icon?: WorkerIconValue | null;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="worker-icon"
      style={{
        fontSize: `${Math.round(size * 0.52)}px`,
        height: `${size}px`,
        width: `${size}px`,
      }}
    >
      {icon?.type === "image" ? (
        <img alt="" src={icon.value} />
      ) : icon?.type === "emoji" ? (
        icon.value
      ) : (
        <Monitor size={Math.round(size * 0.52)} strokeWidth={1.8} />
      )}
    </span>
  );
}
