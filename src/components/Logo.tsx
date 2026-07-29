import briarIconUrl from "../assets/app-icons/aubergine-riso.png";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Briar">
      <img className="brand-mark" src={briarIconUrl} alt="" aria-hidden="true" />
      {!compact && <span className="brand-name">briar</span>}
    </div>
  );
}
