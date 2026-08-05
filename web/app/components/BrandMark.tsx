export default function BrandMark({ subtitle }: { subtitle: string }) {
  return (
    <div className="hb-brand">
      <div className="hb-logo">
        <img src="/logo.jpeg" alt="Visionary Trades" />
      </div>
      <div className="hb-name">Visionary Trades</div>
      <div className="hb-chip">{subtitle}</div>
    </div>
  );
}
