export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Briar">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {!compact && <span className="brand-name">briar</span>}
    </div>
  );
}
