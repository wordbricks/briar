import { Monitor } from "lucide-react";

import type { WorkerIcon as WorkerIconValue } from "../types";

export function WorkerIcon({
  icon,
  glyphSize,
  size = 32,
}: {
  icon?: WorkerIconValue | null;
  glyphSize?: number;
  size?: number;
}) {
  const resolvedGlyphSize = glyphSize ?? Math.round(size * 0.52);
  return (
    <span
      aria-hidden="true"
      className="worker-icon"
      style={{
        fontSize: `${resolvedGlyphSize}px`,
        height: `${size}px`,
        width: `${size}px`,
      }}
    >
      {icon?.type === "image" ? (
        <img alt="" src={icon.value} />
      ) : icon?.type === "emoji" ? (
        icon.value
      ) : (
        <Monitor size={resolvedGlyphSize} strokeWidth={1.8} />
      )}
    </span>
  );
}
