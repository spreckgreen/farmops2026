const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtUsd(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return USD.format(v);
}

export function fmtUsdSigned(n: number): string {
  if (!Number.isFinite(n)) return USD.format(0);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${USD.format(Math.abs(n))}`;
}
