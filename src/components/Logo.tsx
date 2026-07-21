import briarMarkUrl from "../assets/briar-mark.svg";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Briar">
      <img className="brand-mark" src={briarMarkUrl} alt="" aria-hidden="true" />
      {!compact && <span className="brand-name">briar</span>}
    </div>
  );
}
