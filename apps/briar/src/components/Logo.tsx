import briarMarkDarkUrl from "../assets/brand/briar-mark-dark.png";
import briarMarkLightUrl from "../assets/brand/briar-mark-light.png";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Briar">
      <img
        className="brand-mark brand-mark-light"
        src={briarMarkLightUrl}
        alt=""
        aria-hidden="true"
      />
      <img
        className="brand-mark brand-mark-dark"
        src={briarMarkDarkUrl}
        alt=""
        aria-hidden="true"
      />
      {!compact && <span className="brand-name">briar</span>}
    </div>
  );
}
