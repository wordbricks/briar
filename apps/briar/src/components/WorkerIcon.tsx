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
      className="worker-icon grid shrink-0 place-items-center overflow-hidden rounded-[28%] border border-border bg-muted text-muted-foreground leading-none [&_img]:block [&_img]:size-full [&_img]:object-cover"
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
