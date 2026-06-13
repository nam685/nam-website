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
