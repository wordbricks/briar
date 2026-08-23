import briarWhiteStrokeUrl from "../assets/brand/briar-white-stroke.svg";
import briarBlackStrokeUrl from "../assets/brand/briar-black-stroke.svg";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Briar">
      <img
        className="brand-mark brand-mark-light"
        src={briarBlackStrokeUrl}
        alt=""
        aria-hidden="true"
      />
      <img
        className="brand-mark brand-mark-dark"
        src={briarWhiteStrokeUrl}
        alt=""
        aria-hidden="true"
      />
      {!compact && <span className="brand-name">briar</span>}
    </div>
  );
}
