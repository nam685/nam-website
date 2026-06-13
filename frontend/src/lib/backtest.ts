/** Map a numeric series to SVG polyline points spanning [0,width] x [0,height] (y inverted). */
export function curveToPoints(curve: number[], width: number, height: number): string {
  if (curve.length === 0) return "";
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const span = max - min || 1;
  const step = curve.length > 1 ? width / (curve.length - 1) : 0;
  return curve
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Percent with explicit sign and 2 decimals; em-dash for null. */
export function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** USD money formatting. */
export function fmtMoney(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
